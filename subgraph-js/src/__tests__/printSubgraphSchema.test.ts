import { fixtures } from 'apollo-federation-integration-testsuite';
import { buildSubgraphSchema } from '../buildSubgraphSchema';
import { printSubgraphSchema } from '../printSubgraphSchema';
import gql from 'graphql-tag';
import './matchers';
import { FEDERATION2_LINK_WITH_AUTO_EXPANDED_IMPORTS } from '@apollo/federation-internals';
import { buildSchema, executeSync } from 'graphql';

describe('printSubgraphSchema', () => {
  it('prints a subgraph correctly', () => {
    const schema = buildSubgraphSchema(fixtures[0].typeDefs);
    expect(printSubgraphSchema(schema)).toMatchString(`
      schema {
        query: RootQuery
        mutation: Mutation
      }

      extend schema
        ${FEDERATION2_LINK_WITH_AUTO_EXPANDED_IMPORTS}

      directive @stream on FIELD

      directive @transform(from: String!) on FIELD

      directive @cacheControl(maxAge: Int, scope: CacheControlScope, inheritMaxAge: Boolean) on FIELD_DEFINITION | OBJECT | INTERFACE | UNION

      enum CacheControlScope
        @tag(name: "from-reviews")
      {
        PUBLIC @tag(name: "from-reviews")
        PRIVATE
      }

      scalar JSON
        @tag(name: "from-reviews")
        @specifiedBy(url: "https://json-spec.dev")

      type RootQuery {
        user(id: ID!): User
        me: User @cacheControl(maxAge: 1000, scope: PRIVATE)
      }

      type PasswordAccount
        @key(fields: "email")
      {
        email: String!
      }

      type SMSAccount
        @key(fields: "number")
      {
        number: String
      }

      union AccountType
        @tag(name: "from-accounts")
       = PasswordAccount | SMSAccount

      type UserMetadata {
        name: String
        address: String
        description: String
      }

      type User
        @key(fields: "id")
        @key(fields: "username name { first last }")
        @tag(name: "from-accounts")
      {
        id: ID! @tag(name: "accounts")
        name: Name @cacheControl(inheritMaxAge: true)
        username: String @shareable
        birthDate(locale: String @tag(name: "admin")): String @tag(name: "admin") @tag(name: "dev")
        account: AccountType
        metadata: [UserMetadata]
        ssn: String
      }

      type Name {
        first: String
        last: String
      }

      type Mutation {
        login(username: String!, password: String!, userId: String @deprecated(reason: "Use username instead")): User
      }

      type Library
        @key(fields: "id")
      {
        id: ID!
        name: String @external
        userAccount(id: ID! = 1): User @requires(fields: "name")
        description: String @override(from: "books")
      }
    `);
  });

  it('prints a scalar without a directive correctly', () => {
    const schema = gql`
      scalar JSON
    `;
    const subgraphSchema = buildSubgraphSchema(schema);

    expect(printSubgraphSchema(subgraphSchema)).toMatchString(`
      scalar JSON
    `);
  });

  it('prints reviews subgraph correctly', () => {
    const schema = buildSubgraphSchema(fixtures[5].typeDefs);
    expect(printSubgraphSchema(schema)).toMatchString(`
      extend schema
        ${FEDERATION2_LINK_WITH_AUTO_EXPANDED_IMPORTS}

      directive @stream on FIELD

      directive @transform(from: String!) on FIELD

      type Query {
        topReviews(first: Int = 5): [Review]
      }

      type Review
        @key(fields: "id")
      {
        id: ID!
        body(format: Boolean = false): String
        author: User @provides(fields: "username")
        product: Product
        metadata: [MetadataOrError]
      }

      input UpdateReviewInput
        @tag(name: "from-reviews")
      {
        id: ID!
        body: String @tag(name: "from-reviews")
      }

      type UserMetadata {
        address: String @external
      }

      type User
        @key(fields: "id")
        @tag(name: "from-reviews")
      {
        id: ID!
        username: String @external
        reviews: [Review]
        numberOfReviews: Int!
        metadata: [UserMetadata] @external
        goodAddress: Boolean @requires(fields: "metadata { address }")
      }

      interface Product
        @tag(name: "from-reviews")
      {
        reviews: [Review] @tag(name: "from-reviews")
      }

      type Furniture implements Product
        @key(fields: "upc")
      {
        upc: String!
        reviews: [Review]
      }

      type Book implements Product
        @key(fields: "isbn")
      {
        isbn: String!
        reviews: [Review]
        similarBooks: [Book]! @external
        relatedReviews: [Review!]! @requires(fields: "similarBooks { isbn }")
      }

      interface Vehicle {
        retailPrice: String
      }

      type Car implements Vehicle
        @key(fields: "id")
      {
        id: String!
        price: String @external
        retailPrice: String @requires(fields: "price")
      }

      type Van implements Vehicle
        @key(fields: "id")
      {
        id: String!
        price: String @external
        retailPrice: String @requires(fields: "price")
      }

      input ReviewProduct {
        upc: String!
        body: String!
        stars: Int @deprecated(reason: "Stars are no longer in use")
      }

      type Mutation {
        reviewProduct(input: ReviewProduct!): Product
        updateReview(review: UpdateReviewInput! @tag(name: "from-reviews")): Review
        deleteReview(id: ID!): Boolean
      }

      type KeyValue
        @shareable
        @tag(name: "from-reviews")
      {
        key: String! @tag(name: "from-reviews")
        value: String!
      }

      type Error
        @shareable
      {
        code: Int
        message: String
      }

      union MetadataOrError = KeyValue | Error
    `);
  });

  it('outputs can be read by buildSchema', () => {
    const schema = `
      extend schema
        @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key", "@shareable"])

      type Query {
        t: T
      }

      type T
        @key(fields: "id")
      {
        id: ID!
        x: Int @shareable
      }
    `;

    const printed = printSubgraphSchema(buildSubgraphSchema(gql(schema)));
    expect(printed).toMatchString(schema);
  });

  it.only('reproduce', () => {
    const subgraphSchema = buildSubgraphSchema(gql`
      enum MyEnum {
        A
      }

      input HelloInput {
        name: MyEnum = A
      }

      type Query {
        hello(input: HelloInput): String
      }
    `);
    expect(printSubgraphSchema(subgraphSchema)).toMatchString(`
      enum MyEnum {
        A
      }

      input HelloInput {
        name: MyEnum = A
      }

      type Query {
        hello(input: HelloInput): String
      }
    `);

    const introspect = gql`
      query IntrospectionQuery {
        __schema {
          types {
            name
            inputFields {
              name
              defaultValue # <-- this guy
            }
          }
        }
      }
    `;

    const subgraphResult = executeSync({
      schema: subgraphSchema,
      document: introspect,
    });
    expect(subgraphResult).toMatchInlineSnapshot(`
      Object {
        "data": Object {
          "__schema": Object {
            "types": Array [
              Object {
                "inputFields": null,
                "name": "MyEnum",
              },
              Object {
                "inputFields": Array [
                  Object {
                    "defaultValue": "A",
                    "name": "name",
                  },
                ],
                "name": "HelloInput",
              },
              Object {
                "inputFields": null,
                "name": "Query",
              },
              Object {
                "inputFields": null,
                "name": "String",
              },
              Object {
                "inputFields": null,
                "name": "_FieldSet",
              },
              Object {
                "inputFields": null,
                "name": "_Any",
              },
              Object {
                "inputFields": null,
                "name": "_Service",
              },
              Object {
                "inputFields": null,
                "name": "Boolean",
              },
              Object {
                "inputFields": null,
                "name": "__Schema",
              },
              Object {
                "inputFields": null,
                "name": "__Type",
              },
              Object {
                "inputFields": null,
                "name": "__TypeKind",
              },
              Object {
                "inputFields": null,
                "name": "__Field",
              },
              Object {
                "inputFields": null,
                "name": "__InputValue",
              },
              Object {
                "inputFields": null,
                "name": "__EnumValue",
              },
              Object {
                "inputFields": null,
                "name": "__Directive",
              },
              Object {
                "inputFields": null,
                "name": "__DirectiveLocation",
              },
            ],
          },
        },
      }
    `);

    const graphqlSchema = buildSchema(`#graphql
      enum MyEnum {
        A
      }

      input HelloInput {
        name: MyEnum = A
      }

      type Query {
        hello(input: HelloInput): String
      }
    `);

    const graphqlSchemaResult = executeSync({
      schema: graphqlSchema,
      document: introspect,
    });
    expect(graphqlSchemaResult).toMatchInlineSnapshot(`
      Object {
        "data": Object {
          "__schema": Object {
            "types": Array [
              Object {
                "inputFields": null,
                "name": "MyEnum",
              },
              Object {
                "inputFields": Array [
                  Object {
                    "defaultValue": "A",
                    "name": "name",
                  },
                ],
                "name": "HelloInput",
              },
              Object {
                "inputFields": null,
                "name": "Query",
              },
              Object {
                "inputFields": null,
                "name": "String",
              },
              Object {
                "inputFields": null,
                "name": "Boolean",
              },
              Object {
                "inputFields": null,
                "name": "__Schema",
              },
              Object {
                "inputFields": null,
                "name": "__Type",
              },
              Object {
                "inputFields": null,
                "name": "__TypeKind",
              },
              Object {
                "inputFields": null,
                "name": "__Field",
              },
              Object {
                "inputFields": null,
                "name": "__InputValue",
              },
              Object {
                "inputFields": null,
                "name": "__EnumValue",
              },
              Object {
                "inputFields": null,
                "name": "__Directive",
              },
              Object {
                "inputFields": null,
                "name": "__DirectiveLocation",
              },
            ],
          },
        },
      }
    `);
  });
});

import {
  astSerializer,
  queryPlanSerializer,
} from 'apollo-federation-integration-testsuite';
import { getFederatedTestingSchema } from './execution-utils';
import { QueryPlan, QueryPlanner } from '@apollo/query-planner';
import { Schema, parseOperation } from '@apollo/federation-internals';
import gql from 'graphql-tag';

expect.addSnapshotSerializer(astSerializer);
expect.addSnapshotSerializer(queryPlanSerializer);

describe('buildQueryPlan', () => {
  let schema: Schema;
  let queryPlanner: QueryPlanner;

  const buildPlan = (operation: string): QueryPlan => {
    return queryPlanner.buildQueryPlan(parseOperation(schema, operation));
  };

  beforeEach(() => {
    expect(
      () => ({ schema, queryPlanner } = getFederatedTestingSchema()),
    ).not.toThrow();
  });

  it(`should not confuse union types with overlapping field names`, () => {
    const operationString = `#graphql
      query {
          body {
            ... on Image {
              attributes {
                url
              }
            }
            ... on Text {
              attributes {
                bold
                text
              }
            }
          }
        }
    `;
    const queryPlan = buildPlan(operationString);

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Fetch(service: "documents") {
          {
            body {
              __typename
              ... on Image {
                attributes {
                  url
                }
              }
              ... on Text {
                attributes {
                  bold
                  text
                }
              }
            }
          }
        },
      }
    `);
  });

  it(`should use a single fetch when requesting a root field from one service`, () => {
    const operationString = `#graphql
      query {
        me {
          name {
            first
          }
        }
      }
    `;

    const queryPlan = buildPlan(operationString);
    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Fetch(service: "accounts") {
          {
            me {
              name {
                first
              }
            }
          }
        },
      }
    `);
  });

  it(`should use two independent fetches when requesting root fields from two services`, () => {
    const operationString = `#graphql
      query {
        me {
          name {
            first
          }
        }
        topProducts {
          name
        }
      }
    `;

    const queryPlan = buildPlan(operationString);

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Parallel {
          Fetch(service: "accounts") {
            {
              me {
                name {
                  first
                }
              }
            }
          },
          Sequence {
            Fetch(service: "product") {
              {
                topProducts {
                  __typename
                  ... on Book {
                    __typename
                    isbn
                  }
                  ... on Furniture {
                    name
                  }
                }
              }
            },
            Flatten(path: "topProducts.@") {
              Fetch(service: "books") {
                {
                  ... on Book {
                    __typename
                    isbn
                  }
                } =>
                {
                  ... on Book {
                    title
                    year
                  }
                }
              },
            },
            Flatten(path: "topProducts.@") {
              Fetch(service: "product") {
                {
                  ... on Book {
                    __typename
                    title
                    year
                    isbn
                  }
                } =>
                {
                  ... on Book {
                    name
                  }
                }
              },
            },
          },
        },
      }
    `);
  });

  it(`should use a single fetch when requesting multiple root fields from the same service`, () => {
    const operationString = `#graphql
      query {
        topProducts {
          name
        }
        product(upc: "1") {
          name
        }
      }
    `;

    const queryPlan = buildPlan(operationString);

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Sequence {
          Fetch(service: "product") {
            {
              topProducts {
                __typename
                ... on Book {
                  __typename
                  isbn
                }
                ... on Furniture {
                  name
                }
              }
              product(upc: "1") {
                __typename
                ... on Book {
                  __typename
                  isbn
                }
                ... on Furniture {
                  name
                }
              }
            }
          },
          Parallel {
            Sequence {
              Flatten(path: "topProducts.@") {
                Fetch(service: "books") {
                  {
                    ... on Book {
                      __typename
                      isbn
                    }
                  } =>
                  {
                    ... on Book {
                      title
                      year
                    }
                  }
                },
              },
              Flatten(path: "topProducts.@") {
                Fetch(service: "product") {
                  {
                    ... on Book {
                      __typename
                      title
                      year
                      isbn
                    }
                  } =>
                  {
                    ... on Book {
                      name
                    }
                  }
                },
              },
            },
            Sequence {
              Flatten(path: "product") {
                Fetch(service: "books") {
                  {
                    ... on Book {
                      __typename
                      isbn
                    }
                  } =>
                  {
                    ... on Book {
                      title
                      year
                    }
                  }
                },
              },
              Flatten(path: "product") {
                Fetch(service: "product") {
                  {
                    ... on Book {
                      __typename
                      title
                      year
                      isbn
                    }
                  } =>
                  {
                    ... on Book {
                      name
                    }
                  }
                },
              },
            },
          },
        },
      }
    `);
  });

  it(`should use a single fetch when requesting relationship subfields from the same service`, () => {
    const operationString = `#graphql
      query {
        topReviews {
          body
          author {
            reviews {
              body
            }
          }
        }
      }
    `;

    const queryPlan = buildPlan(operationString);

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Fetch(service: "reviews") {
          {
            topReviews {
              body
              author {
                reviews {
                  body
                }
              }
            }
          }
        },
      }
    `);
  });

  it(`should use a single fetch when requesting relationship subfields and provided keys from the same service`, () => {
    const operationString = `#graphql
      query {
        topReviews {
          body
          author {
            id
            reviews {
              body
            }
          }
        }
      }
    `;

    const queryPlan = buildPlan(operationString);

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Fetch(service: "reviews") {
          {
            topReviews {
              body
              author {
                id
                reviews {
                  body
                }
              }
            }
          }
        },
      }
    `);
  });

  describe(`when requesting an extension field from another service`, () => {
    it(`should add the field's representation requirements to the parent selection set and use a dependent fetch`, () => {
      const operationString = `#graphql
        query {
          me {
            name {
              first
            }
            reviews {
              body
            }
          }
        }
      `;

      const queryPlan = buildPlan(operationString);

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Sequence {
            Fetch(service: "accounts") {
              {
                me {
                  __typename
                  id
                  name {
                    first
                  }
                }
              }
            },
            Flatten(path: "me") {
              Fetch(service: "reviews") {
                {
                  ... on User {
                    __typename
                    id
                  }
                } =>
                {
                  ... on User {
                    reviews {
                      body
                    }
                  }
                }
              },
            },
          },
        }
      `);
    });

    describe(`when the parent selection set is empty`, () => {
      it(`should add the field's requirements to the parent selection set and use a dependent fetch`, () => {
        const operationString = `#graphql
          query {
            me {
              reviews {
                body
              }
            }
          }
        `;

        const queryPlan = buildPlan(operationString);

        expect(queryPlan).toMatchInlineSnapshot(`
          QueryPlan {
            Sequence {
              Fetch(service: "accounts") {
                {
                  me {
                    __typename
                    id
                  }
                }
              },
              Flatten(path: "me") {
                Fetch(service: "reviews") {
                  {
                    ... on User {
                      __typename
                      id
                    }
                  } =>
                  {
                    ... on User {
                      reviews {
                        body
                      }
                    }
                  }
                },
              },
            },
          }
        `);
      });
    });

    it(`should only add requirements once`, () => {
      const operationString = `#graphql
        query {
          me {
            reviews {
              body
            }
            numberOfReviews
          }
        }
      `;

      const queryPlan = buildPlan(operationString);

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Sequence {
            Fetch(service: "accounts") {
              {
                me {
                  __typename
                  id
                }
              }
            },
            Flatten(path: "me") {
              Fetch(service: "reviews") {
                {
                  ... on User {
                    __typename
                    id
                  }
                } =>
                {
                  ... on User {
                    reviews {
                      body
                    }
                    numberOfReviews
                  }
                }
              },
            },
          },
        }
      `);
    });
  });

  describe(`when requesting a composite field with subfields from another service`, () => {
    it(`should add key fields to the parent selection set and use a dependent fetch`, () => {
      const operationString = `#graphql
        query {
          topReviews {
            body
            author {
              name {
                first
              }
            }
          }
        }
      `;

      const queryPlan = buildPlan(operationString);

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Sequence {
            Fetch(service: "reviews") {
              {
                topReviews {
                  body
                  author {
                    __typename
                    id
                  }
                }
              }
            },
            Flatten(path: "topReviews.@.author") {
              Fetch(service: "accounts") {
                {
                  ... on User {
                    __typename
                    id
                  }
                } =>
                {
                  ... on User {
                    name {
                      first
                    }
                  }
                }
              },
            },
          },
        }
      `);
    });

    describe(`when requesting a field defined in another service which requires a field in the base service`, () => {
      it(`should add the field provided by base service in first Fetch`, () => {
        const operationString = `#graphql
          query {
            topCars {
              retailPrice
            }
          }
        `;

        const queryPlan = buildPlan(operationString);

        expect(queryPlan).toMatchInlineSnapshot(`
          QueryPlan {
            Sequence {
              Fetch(service: "product") {
                {
                  topCars {
                    __typename
                    id
                    price
                  }
                }
              },
              Flatten(path: "topCars.@") {
                Fetch(service: "reviews") {
                  {
                    ... on Car {
                      __typename
                      id
                      price
                    }
                  } =>
                  {
                    ... on Car {
                      retailPrice
                    }
                  }
                },
              },
            },
          }
        `);
      });
    });

    describe(`when the parent selection set is empty`, () => {
      it(`should add key fields to the parent selection set and use a dependent fetch`, () => {
        const operationString = `#graphql
          query {
            topReviews {
              author {
                name {
                  first
                }
              }
            }
          }
        `;

        const queryPlan = buildPlan(operationString);

        expect(queryPlan).toMatchInlineSnapshot(`
          QueryPlan {
            Sequence {
              Fetch(service: "reviews") {
                {
                  topReviews {
                    author {
                      __typename
                      id
                    }
                  }
                }
              },
              Flatten(path: "topReviews.@.author") {
                Fetch(service: "accounts") {
                  {
                    ... on User {
                      __typename
                      id
                    }
                  } =>
                  {
                    ... on User {
                      name {
                        first
                      }
                    }
                  }
                },
              },
            },
          }
        `);
      });
    });
  });
  describe(`when requesting a relationship field with extension subfields from a different service`, () => {
    it(`should first fetch the object using a key from the base service and then pass through the requirements`, () => {
      const operationString = `#graphql
        query {
          topReviews {
            author {
              birthDate
            }
          }
        }
      `;

      const queryPlan = buildPlan(operationString);

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Sequence {
            Fetch(service: "reviews") {
              {
                topReviews {
                  author {
                    __typename
                    id
                  }
                }
              }
            },
            Flatten(path: "topReviews.@.author") {
              Fetch(service: "accounts") {
                {
                  ... on User {
                    __typename
                    id
                  }
                } =>
                {
                  ... on User {
                    birthDate
                  }
                }
              },
            },
          },
        }
      `);
    });
  });

  describe(`for abstract types`, () => {
    // GraphQLError: Cannot query field "isbn" on type "Book"
    // Probably an issue with extending / interfaces in composition. None of the fields from the base Book type
    // are showing up in the resulting schema.
    it(`should add __typename when fetching objects of an interface type from a service`, () => {
      const operationString = `#graphql
        query {
          topProducts {
            price
          }
        }
      `;

      const queryPlan = buildPlan(operationString);

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Fetch(service: "product") {
            {
              topProducts {
                __typename
                price
              }
            }
          },
        }
      `);
    });

    it(`should not get confused by a fragment spread multiple times`, () => {
      const operationString = `#graphql
        fragment PriceAndCountry on Product {
          price
          details {
            country
          }
        }

        query {
          topProducts {
            __typename
            ... on Book {
              ...PriceAndCountry
            }
            ... on Furniture {
              ...PriceAndCountry
            }
          }
        }
      `;

      const queryPlan = buildPlan(operationString);

      expect(queryPlan).toMatchInlineSnapshot(`
                QueryPlan {
                  Fetch(service: "product") {
                    {
                      topProducts {
                        __typename
                        ... on Book {
                          ...PriceAndCountry
                        }
                        ... on Furniture {
                          ...PriceAndCountry
                        }
                      }
                    }

                    fragment PriceAndCountry on Product {
                      price
                      details {
                        __typename
                        country
                      }
                    }
                  },
                }
            `);
    });

    it(`should not get confused by an inline fragment multiple times`, () => {
      const operationString = `#graphql
        query {
          topProducts {
            __typename
            ... on Book {
              ...on Product {
                price
              }
            }
            ... on Furniture {
              ... on Product {
                price
              }
            }
          }
        }
      `;

      const queryPlan = buildPlan(operationString);

      expect(queryPlan).toMatchInlineSnapshot(`
                QueryPlan {
                  Fetch(service: "product") {
                    {
                      topProducts {
                        __typename
                        ... on Book {
                          price
                        }
                        ... on Furniture {
                          price
                        }
                      }
                    }
                  },
                }
            `);
    });

    it(`eliminate unecessary type conditions`, () => {
      const operationString = `#graphql
        query {
          body {
            ... on Image {
              ... on NamedObject {
                name
              }
            }
          }
        }
      `;

      const queryPlan = buildPlan(operationString);

      expect(queryPlan).toMatchInlineSnapshot(`
                QueryPlan {
                  Fetch(service: "documents") {
                    {
                      body {
                        __typename
                        ... on Image {
                          name
                        }
                      }
                    }
                  },
                }
            `);
    });

    it(`should preserve directives on inline fragments even if the fragment is otherwise useless`, () => {
      const operationString = `#graphql
        query myQuery($b: Boolean!) {
          body {
            ... on Image {
              ... on NamedObject @include(if: $b) {
                name
              }
            }
          }
        }
      `;

      const queryPlan = buildPlan(operationString);

      expect(queryPlan).toMatchInlineSnapshot(`
                QueryPlan {
                  Fetch(service: "documents") {
                    {
                      body {
                        __typename
                        ... on Image {
                          ... on NamedObject @include(if: $b) {
                            __typename
                            name
                          }
                        }
                      }
                    }
                  },
                }
            `);
    });
  });

  // GraphQLError: Cannot query field "isbn" on type "Book"
  // Probably an issue with extending / interfaces in composition. None of the fields from the base Book type
  // are showing up in the resulting schema.
  it(`should break up when traversing an extension field on an interface type from a service`, () => {
    const operationString = `#graphql
      query {
        topProducts {
          price
          reviews {
            body
          }
        }
      }
    `;

    const queryPlan = buildPlan(operationString);

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Sequence {
          Fetch(service: "product") {
            {
              topProducts {
                __typename
                price
                ... on Book {
                  __typename
                  isbn
                }
                ... on Furniture {
                  __typename
                  upc
                }
              }
            }
          },
          Flatten(path: "topProducts.@") {
            Fetch(service: "reviews") {
              {
                ... on Book {
                  __typename
                  isbn
                }
                ... on Furniture {
                  __typename
                  upc
                }
              } =>
              {
                ... on Book {
                  reviews {
                    body
                  }
                }
                ... on Furniture {
                  reviews {
                    body
                  }
                }
              }
            },
          },
        },
      }
    `);
  });

  it(`interface fragments should expand into possible types only`, () => {
    const operationString = `#graphql
      query {
        books {
          ... on Product {
            name
            ... on Furniture {
              upc
            }
          }
        }
      }
    `;

    const queryPlan = buildPlan(operationString);

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Sequence {
          Fetch(service: "books") {
            {
              books {
                __typename
                isbn
                title
                year
              }
            }
          },
          Flatten(path: "books.@") {
            Fetch(service: "product") {
              {
                ... on Book {
                  __typename
                  isbn
                  title
                  year
                }
              } =>
              {
                ... on Book {
                  name
                }
              }
            },
          },
        },
      }
    `);
  });

  it(`interface inside interface should not type explode if possible`, () => {
    const operationString = `#graphql
      query {
        product(upc: "") {
          details {
            country
          }
        }
      }
    `;

    const queryPlan = buildPlan(operationString);

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Fetch(service: "product") {
          {
            product(upc: "") {
              __typename
              details {
                __typename
                country
              }
            }
          }
        },
      }
    `);
  });

  it(`should properly expand nested unions with inline fragments`, () => {
    const operationString = `#graphql
      query {
        body {
          ... on Image {
            ... on Body {
              ... on Image {
                attributes {
                  url
                }
              }
              ... on Text {
                attributes {
                  bold
                  text
                }
              }
            }
          }
          ... on Text {
            attributes {
              bold
            }
          }
        }
      }
    `;

    const queryPlan = buildPlan(operationString);

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Fetch(service: "documents") {
          {
            body {
              __typename
              ... on Image {
                attributes {
                  url
                }
              }
              ... on Text {
                attributes {
                  bold
                }
              }
            }
          }
        },
      }
    `);
  });

  describe('deduplicates fields / selections regardless of adjacency and type condition nesting', () => {
    it('for inline fragments', () => {
      const operationString = `#graphql
        query {
          body {
            ... on Body {
              ... on Text {
                attributes {
                  bold
                  text
                }
              }
            }
            ... on Text {
              attributes {
                bold
                text
              }
            }
          }
        }
      `;

      const queryPlan = buildPlan(operationString);

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Fetch(service: "documents") {
            {
              body {
                __typename
                ... on Text {
                  attributes {
                    bold
                    text
                  }
                }
              }
            }
          },
        }
      `);
    });

    it('for named fragment spreads', () => {
      const operationString = `#graphql
        fragment TextFragment on Text {
          attributes {
            bold
            text
          }
        }

        query {
          body {
            ... on Body {
              ...TextFragment
            }
            ...TextFragment
          }
        }
      `;

      const queryPlan = buildPlan(operationString);

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Fetch(service: "documents") {
            {
              body {
                __typename
                ... on Text {
                  attributes {
                    bold
                    text
                  }
                }
              }
            }
          },
        }
      `);
    });
  });

  describe('overridden fields and type', () => {
    it(`query plan of overridden field`, () => {
      const operationString = `#graphql
        query {
          library (id: "3") {
            name
            description
          }
        }
      `;

      const queryPlan = buildPlan(operationString);
      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Sequence {
            Fetch(service: "books") {
              {
                library(id: 3) {
                  __typename
                  id
                  name
                }
              }
            },
            Flatten(path: "library") {
              Fetch(service: "accounts") {
                {
                  ... on Library {
                    __typename
                    id
                  }
                } =>
                {
                  ... on Library {
                    description
                  }
                }
              },
            },
          },
        }
      `);
    });
  });

  it.only('reproduction', () => {
    const s1 = {
      name: 's1',
      typeDefs: gql`
        scalar JSON

        type Query {
          tpquery: TPResponse
        }

        type TPResponse {
          tp: TP
        }

        type TP {
          pg: [TPPG!]!
        }

        type TPPG {
          fieldA: [TPA!]!
        }

        interface CA {
          canDeselect: Boolean!
        }

        union TPA = CCA | DSA

        type CCA implements CA {
          canDeselect: Boolean!
          c1: C1
        }

        type DSA implements CA {
          canDeselect: Boolean!
          c1: C2
        }

        extend type C2 @key(fields: "id") {
          id: ID! @external
          needsBoolean: Boolean!
        }

        extend type C1 @key(fields: "id _prefetch_") {
          id: ID! @external
          _prefetch_: JSON @external
          needsBoolean: Boolean!
        }
      `,
    };

    const s2 = {
      name: 's2',
      typeDefs: gql`
        scalar JSON

        type O1 {
          field1: String
        }

        type Query {
          getE2: O1
        }

        interface EBase {
          id: ID!
          field1: String
        }

        type C2 implements EBase @key(fields: "id") {
          id: ID!
          field1: String
          isDefault: Boolean
        }

        type C1 implements EBase
          @key(fields: "id _prefetch_")
          @key(fields: "id") {
          id: ID!
          _prefetch_: JSON
          field1: String
          isDefault: Boolean #@requires(fields: "_prefetch_")
        }
      `,
    };

    ({ schema, queryPlanner } = getFederatedTestingSchema([s1, s2]));

    const plan = buildPlan(`#graphql
      query tp {
        tpquery {
          tp {
            pg {
              fieldA {
                ... on CCA {
                  canDeselect
                  c1 {
                    __typename
                    id
                    isDefault
                  }
                }
                ... on DSA {
                  canDeselect
                  c1 {
                    __typename
                    id
                    isDefault
                  }
                }
              }
            }
          }
        }
      }
      `);

    // Expecting the following :
    // ... on CCA {
    //   canDeselect
    //   c1 {
    //     __typename
    //     id
    //     _prefetch_
    //   }
    // }
    expect(plan).toMatchInlineSnapshot(`
      QueryPlan {
        Sequence {
          Fetch(service: "s1") {
            {
              tpquery {
                tp {
                  pg {
                    fieldA {
                      __typename
                      ... on CCA {
                        canDeselect
                        c1 {
                          __typename
                          id
                        }
                      }
                      ... on DSA {
                        canDeselect
                        c1 {
                          __typename
                          id
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          Flatten(path: "tpquery.tp.pg.@.fieldA.@.c1") {
            Fetch(service: "s2") {
              {
                ... on C1 {
                  __typename
                  id
                }
                ... on C2 {
                  __typename
                  id
                }
              } =>
              {
                ... on C1 {
                  isDefault
                }
                ... on C2 {
                  isDefault
                }
              }
            },
          },
        },
      }
    `);
  });
});

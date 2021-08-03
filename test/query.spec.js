import mocha from "mocha";
const { describe, it } = mocha;
import { assert } from "chai";

import { createComponent, createQuery, i8 } from "../demo/miski.min.js";

const testComponentSpec = {
  name: "test",
  schema: {
    value: i8,
  },
}

describe("Query", function() {
  it("creates a Query without error", function() {
    const query = createQuery({});
    assert.exists(query);
  });
  it("creates a Query with Components without error", function() {
    const component = createComponent(testComponentSpec);
    const query = createQuery({all: [component]});
    assert.exists(query);
    assert.equal(query.all[0], component);
  });
  it("fails to a Query with invalid Component", function() {
    assert.throws(() => createQuery({all: [{}]}))
  });
});

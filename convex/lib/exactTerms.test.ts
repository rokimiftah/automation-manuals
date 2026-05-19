import { describe, expect, it } from "vitest"

import { buildChunkTerms, extractExactSearchTerms, isFaultCodeLikeExactTerm, isStrongExactIdentifierTerm } from "./exactTerms"

describe("extractExactSearchTerms", () => {
  it("prioritizes short E and F fault code identifiers", () => {
    const terms = extractExactSearchTerms("Fault E1 and F1 appeared")

    expect(isFaultCodeLikeExactTerm("E1")).toBe(true)
    expect(isFaultCodeLikeExactTerm("F1")).toBe(true)
    expect(terms).toContain("e1")
    expect(terms).toContain("f1")
    expect(terms.indexOf("e1")).toBeLessThan(terms.indexOf("fault"))
    expect(terms.indexOf("f1")).toBeLessThan(terms.indexOf("appeared"))
  })

  it("emits hyphenated and compact fault code variants", () => {
    const terms = extractExactSearchTerms("Fault F-002 appeared")

    expect(terms).toContain("f-002")
    expect(terms).toContain("f002")
  })

  it("includes diagnostic identifiers within the queried term window", () => {
    const terms = extractExactSearchTerms("What should I check for F002 after first power on?").slice(0, 12)

    expect(terms).toContain("f002")
  })

  it("prioritizes fault code identifiers before product model identifiers", () => {
    const terms = extractExactSearchTerms("Siemens SINAMICS G120 F002 after first power on").slice(0, 12)

    expect(terms).toContain("f002")
    expect(terms).toContain("g120")
    expect(terms.indexOf("f002")).toBeLessThan(terms.indexOf("g120"))
  })
})

describe("buildChunkTerms", () => {
  it("indexes late fault code identifiers as standalone variants", () => {
    const prefix = Array.from({ length: 65 }, (_, index) => `token${index + 1}`).join(" ")

    const terms = buildChunkTerms({
      citationLabel: "Page 99",
      content: `${prefix} F002 overvoltage fault table.`
    })

    expect(terms).toContain("f002")
    expect(terms).toContain("f-002")
  })

  it("caps strong identifier variants from long content", () => {
    const content = Array.from({ length: 200 }, (_, index) => `M${String(index + 1).padStart(4, "0")}`).join(" ")

    const terms = buildChunkTerms({
      citationLabel: "Page 7",
      content
    })

    const strongIdentifierTerms = terms.filter((term) => isStrongExactIdentifierTerm(term))

    expect(strongIdentifierTerms).toHaveLength(32)
  })
})

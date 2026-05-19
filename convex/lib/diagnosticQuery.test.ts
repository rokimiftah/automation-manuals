import { describe, expect, it } from "vitest"

import {
  buildClarificationPromptInput,
  extractLiteralIdentifiers,
  hasDiagnosticSignals,
  understandDiagnosticQuery
} from "./diagnosticQuery"

const scopes = [
  {
    documentId: "documents_1",
    language: "English",
    productSlug: "sinamics-g120",
    title: "SINAMICS G120 Operating Instructions",
    vendorSlug: "siemens",
    version: "v1"
  },
  {
    documentId: "documents_2",
    language: "English",
    productSlug: "powerflex-755",
    title: "PowerFlex 755 User Manual",
    vendorSlug: "rockwell-automation",
    version: "v2"
  }
]

describe("hasDiagnosticSignals", () => {
  it("detects installation and fault narratives", () => {
    expect(hasDiagnosticSignals("Saya install drive baru, setelah power on muncul F002.")).toBe(true)
    expect(hasDiagnosticSignals("What does Rockwell Automation mean?")).toBe(false)
  })

  it("does not treat wireless as a wiring keyword", () => {
    expect(hasDiagnosticSignals("Wireless adapter manual overview")).toBe(false)
  })
})

describe("extractLiteralIdentifiers", () => {
  it("ignores plain numbers and dates", () => {
    expect(extractLiteralIdentifiers("What is on page 12 in 2024?")).toEqual([])
  })

  it("ignores date and quarter-like identifiers", () => {
    expect(extractLiteralIdentifiers("Review 2024-Q1 maintenance summary")).toEqual([])
    expect(hasDiagnosticSignals("Review 2024-Q1 maintenance summary")).toBe(false)
    expect(extractLiteralIdentifiers("Review Q1 2024 maintenance summary")).toEqual([])
    expect(hasDiagnosticSignals("Review Q1 2024 maintenance summary")).toBe(false)
    expect(extractLiteralIdentifiers("Review Q1-2024 maintenance summary")).toEqual([])
    expect(hasDiagnosticSignals("Review Q1-2024 maintenance summary")).toBe(false)
    expect(extractLiteralIdentifiers("Review Q4-2024 maintenance summary")).toEqual([])
    expect(hasDiagnosticSignals("Review Q4-2024 maintenance summary")).toBe(false)
  })

  it("ignores voltage supply descriptions for this diagnostic slice", () => {
    expect(extractLiteralIdentifiers("Check 24V supply")).toEqual([])
  })

  it("extracts short and separated fault codes", () => {
    expect(extractLiteralIdentifiers("Fault E1 and F-002 appeared")).toEqual(["E1", "F-002"])
  })

  it("extracts drive and controller model identifiers", () => {
    expect(extractLiteralIdentifiers("Fault F002 on G120 and 1756-L7SP")).toEqual(["F002", "G120", "1756-L7SP"])
  })
})

describe("understandDiagnosticQuery", () => {
  it("requires vendor and model context for ambiguous operational fault codes", () => {
    const result = understandDiagnosticQuery("Saya install drive baru, setelah power on muncul F002. Motor belum jalan.", scopes)

    expect(result).toMatchObject({
      intent: "troubleshooting",
      severity: "operational",
      stage: "first_power_on",
      literalIdentifiers: ["F002"],
      missingContext: ["vendor", "model"],
      needsClarification: true,
      productCategory: "drive"
    })
  })

  it("requires vendor and model context for no-code first-power-on operational symptoms", () => {
    const result = understandDiagnosticQuery("Motor belum jalan setelah power on", scopes)

    expect(result).toMatchObject({
      intent: "troubleshooting",
      severity: "operational",
      stage: "first_power_on",
      missingContext: ["vendor", "model"],
      needsClarification: true
    })
  })

  it("resolves vendor and product scope when the question names a known document family", () => {
    const result = understandDiagnosticQuery("Siemens SINAMICS G120 F002 after first power on", scopes)

    expect(result).toMatchObject({
      intent: "troubleshooting",
      literalIdentifiers: ["G120", "F002"],
      missingContext: [],
      needsClarification: false,
      resolvedScope: {
        productSlug: "sinamics-g120",
        vendorSlug: "siemens"
      }
    })
  })

  it("does not resolve product scopes by prefix substring", () => {
    const result = understandDiagnosticQuery("PowerFlex 7550 F002", [scopes[1]])

    expect(result.resolvedScope).toBeNull()
    expect(result.missingContext).toEqual(["vendor", "model"])
    expect(result.needsClarification).toBe(true)
  })

  it("does not classify wireless as wiring", () => {
    const result = understandDiagnosticQuery("Wireless adapter manual overview", scopes)

    expect(result.intent).toBe("unknown")
    expect(result.severity).toBe("informational")
  })

  it("does not require clarification for general informational lookups", () => {
    const result = understandDiagnosticQuery("manual overview", scopes)

    expect(result).toMatchObject({
      intent: "unknown",
      severity: "informational",
      missingContext: [],
      needsClarification: false
    })
  })

  it("does not force vendor scoping for explicit comparison questions", () => {
    const result = understandDiagnosticQuery("Compare F002 behavior between Siemens and Rockwell manuals", scopes)

    expect(result.intent).toBe("comparison")
    expect(result.needsClarification).toBe(false)
    expect(result.resolvedScope).toBeNull()
  })
})

describe("buildClarificationPromptInput", () => {
  it("builds language-neutral clarification prompt input", () => {
    const result = understandDiagnosticQuery("F002 after first power on", scopes)

    expect(buildClarificationPromptInput(result)).toEqual({
      interpretedProblem: "F002 after first power on",
      missingContext: ["vendor", "model"]
    })
  })
})

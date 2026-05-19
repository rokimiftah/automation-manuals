export type EvaluationCategory =
  | "exact-lookup"
  | "table-reasoning"
  | "diagram-reasoning"
  | "not-found"
  | "multi-vendor-clarification"
  | "error-code-collision"
  | "wrong-version-trap"
  | "safety-critical-instruction"

export type EvaluationSeed = {
  category: EvaluationCategory
  expectedAnswerabilityStatus?: "grounded" | "insufficient_evidence" | "needs_clarification"
  expectedDocumentTitle: string
  expectedPageNumbers: number[]
  expectedRefusal: boolean
  question: string
  severity: "informational" | "operational" | "safety-critical"
  slug: string
}

export const defaultEvaluationCases: EvaluationSeed[] = [
  {
    slug: "guardlogix-partner-slot",
    question: "Where should the 1756-L7SP safety partner be installed relative to the primary controller?",
    category: "diagram-reasoning",
    severity: "safety-critical",
    expectedDocumentTitle: "GuardLogix 5570 Controllers User Manual",
    expectedPageNumbers: [9],
    expectedRefusal: false
  },
  {
    slug: "guardlogix-led-solid-red",
    question: "What does a solid red OK LED on the 1756-L7SP mean?",
    category: "table-reasoning",
    severity: "operational",
    expectedDocumentTitle: "GuardLogix 5570 Controllers User Manual",
    expectedPageNumbers: [45],
    expectedRefusal: false
  },
  {
    slug: "guardlogix-missing-evidence",
    question: "What is the torque value for terminal block X99 in this manual?",
    category: "not-found",
    severity: "informational",
    expectedDocumentTitle: "GuardLogix 5570 Controllers User Manual",
    expectedPageNumbers: [],
    expectedRefusal: true
  },
  {
    slug: "guardlogix-catalog-number",
    question: "Which catalog number corresponds to the safety partner module?",
    category: "exact-lookup",
    severity: "informational",
    expectedDocumentTitle: "GuardLogix 5570 Controllers User Manual",
    expectedPageNumbers: [9],
    expectedRefusal: false
  },
  {
    slug: "multi-vendor-f002-missing-scope",
    question: "Saya install drive baru, setelah power on muncul F002. Motor belum jalan.",
    category: "multi-vendor-clarification",
    severity: "operational",
    expectedAnswerabilityStatus: "needs_clarification",
    expectedDocumentTitle: "",
    expectedPageNumbers: [],
    expectedRefusal: true
  },
  {
    slug: "multi-vendor-error-code-collision",
    question: "What should I check for F002 after first power on?",
    category: "error-code-collision",
    severity: "operational",
    expectedAnswerabilityStatus: "needs_clarification",
    expectedDocumentTitle: "",
    expectedPageNumbers: [],
    expectedRefusal: true
  },
  {
    slug: "sinamics-g120-f002-scoped",
    question: "Siemens SINAMICS G120 F002 after first power on",
    category: "exact-lookup",
    severity: "operational",
    expectedAnswerabilityStatus: "grounded",
    expectedDocumentTitle: "SINAMICS G120 Operating Instructions",
    expectedPageNumbers: [],
    expectedRefusal: false
  }
]

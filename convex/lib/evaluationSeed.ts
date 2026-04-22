export type EvaluationCategory =
  | "exact-lookup"
  | "table-reasoning"
  | "diagram-reasoning"
  | "not-found"

export type EvaluationSeed = {
  category: EvaluationCategory
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
  }
]

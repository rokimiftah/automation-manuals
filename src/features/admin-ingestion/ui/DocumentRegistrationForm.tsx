import { useRef, useState, useTransition } from "react"

export type DocumentFormValues = {
  vendorName: string
  productName: string
  title: string
  version: string
  language: string
  sourceFile: File | null
}

const initialValues: DocumentFormValues = {
  vendorName: "",
  productName: "",
  title: "",
  version: "",
  language: "English",
  sourceFile: null
}

type DocumentRegistrationFormProps = {
  onSubmit: (values: DocumentFormValues) => Promise<void>
}

const inputClassName =
  "w-full bg-[#FAFAFA] wire-border px-4 py-3.5 text-[14px] font-medium text-[#000000] outline-none transition-colors focus:bg-white placeholder:text-[#999999]"

export default function DocumentRegistrationForm({ onSubmit }: DocumentRegistrationFormProps) {
  const [values, setValues] = useState(initialValues)
  const [error, setError] = useState<string>()
  const [isPending, startTransition] = useTransition()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isDisabled = isPending || isSubmitting

  return (
    <section className="relative flex flex-1 flex-col bg-white">
      <div className="wire-border-b shrink-0 bg-[#FAFAFA] p-6">
        <h2 className="text-[14px] font-medium tracking-widest text-[#000000] uppercase">Input Manual Data</h2>
      </div>

      <form
        className="flex flex-1 flex-col bg-white p-6"
        onSubmit={async (event) => {
          event.preventDefault()

          const normalizedValues: DocumentFormValues = {
            vendorName: values.vendorName.trim(),
            productName: values.productName.trim(),
            title: values.title.trim(),
            version: values.version.trim(),
            language: values.language.trim(),
            sourceFile: values.sourceFile
          }

          if (
            !normalizedValues.vendorName ||
            !normalizedValues.productName ||
            !normalizedValues.title ||
            !normalizedValues.version ||
            !normalizedValues.language ||
            !normalizedValues.sourceFile
          ) {
            setError("Validation Err: Incomplete parameters.")
            return
          }

          setError(undefined)
          setIsSubmitting(true)

          try {
            await onSubmit(normalizedValues)
            startTransition(() => {
              setValues(initialValues)
              if (fileInputRef.current) {
                fileInputRef.current.value = ""
              }
            })
          } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "Ingestion fault.")
          } finally {
            setIsSubmitting(false)
          }
        }}
      >
        <div className="flex flex-1 flex-col gap-6">
          <div className="grid gap-6 md:grid-cols-2">
            <label className="flex flex-col gap-3">
              <span className="font-mono text-[11px] tracking-widest text-[#000000] uppercase">Manufacturer</span>
              <input
                className={inputClassName}
                disabled={isDisabled}
                placeholder="Rockwell Automation"
                value={values.vendorName}
                onChange={(event) => setValues((current) => ({ ...current, vendorName: event.target.value }))}
              />
            </label>

            <label className="flex flex-col gap-3">
              <span className="font-mono text-[11px] tracking-widest text-[#000000] uppercase">Apparatus</span>
              <input
                className={inputClassName}
                disabled={isDisabled}
                placeholder="GuardLogix 5570"
                value={values.productName}
                onChange={(event) => setValues((current) => ({ ...current, productName: event.target.value }))}
              />
            </label>

            <label className="flex flex-col gap-3 md:col-span-2">
              <span className="font-mono text-[11px] tracking-widest text-[#000000] uppercase">Document Title</span>
              <input
                className={inputClassName}
                disabled={isDisabled}
                placeholder="GuardLogix 5570 Controllers User Manual"
                value={values.title}
                onChange={(event) => setValues((current) => ({ ...current, title: event.target.value }))}
              />
            </label>

            <label className="flex flex-col gap-3">
              <span className="font-mono text-[11px] tracking-widest text-[#000000] uppercase">Edition</span>
              <input
                className={inputClassName}
                disabled={isDisabled}
                placeholder="20.01"
                value={values.version}
                onChange={(event) => setValues((current) => ({ ...current, version: event.target.value }))}
              />
            </label>

            <label className="flex flex-col gap-3">
              <span className="font-mono text-[11px] tracking-widest text-[#000000] uppercase">Dialect</span>
              <input
                className={inputClassName}
                disabled={isDisabled}
                placeholder="English"
                value={values.language}
                onChange={(event) => setValues((current) => ({ ...current, language: event.target.value }))}
              />
            </label>
          </div>

          <label className="flex flex-col gap-3">
            <span className="font-mono text-[11px] tracking-widest text-[#000000] uppercase">Source PDF</span>
            <input
              ref={fileInputRef}
              accept="application/pdf,.pdf"
              className={inputClassName}
              disabled={isDisabled}
              type="file"
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  sourceFile: event.target.files?.[0] ?? null
                }))
              }
            />
            <span className="font-mono text-[11px] tracking-widest text-[#555555] uppercase">
              {values.sourceFile ? values.sourceFile.name : "No file selected"}
            </span>
          </label>

          {error ? (
            <div className="wire-border relative flex items-start gap-6 overflow-hidden bg-white p-6 font-mono text-[13px] text-[#000000]">
              <div className="diagonal-bg pointer-events-none absolute inset-0 opacity-20"></div>
              <span className="relative z-10 shrink-0 bg-[#000000] px-2 py-0.5 text-[10px] tracking-widest text-white uppercase">
                ERR
              </span>
              <span className="relative z-10">{error}</span>
            </div>
          ) : null}
        </div>

        <div className="mt-auto flex flex-col justify-end gap-6 pt-6 sm:flex-row sm:items-center">
          <button
            className="wire-border w-full bg-[#000000] px-8 py-4 text-[12px] font-medium tracking-[0.2em] text-white uppercase transition-colors hover:bg-white hover:text-[#000000] active:scale-[0.98] disabled:pointer-events-none disabled:bg-[#FAFAFA] disabled:text-[#999999] sm:w-auto"
            disabled={isDisabled}
            type="submit"
          >
            {isDisabled ? "[ Queueing... ]" : "[ Enqueue Data ]"}
          </button>
        </div>
      </form>
    </section>
  )
}

import { useState, useTransition } from "react"

export type DocumentFormValues = {
  vendorName: string
  productName: string
  title: string
  version: string
  language: string
  sourceUrl: string
}

const initialValues: DocumentFormValues = {
  vendorName: "",
  productName: "",
  title: "",
  version: "",
  language: "English",
  sourceUrl: ""
}

type DocumentRegistrationFormProps = {
  onSubmit: (values: DocumentFormValues) => Promise<void>
}

const inputClassName =
  "mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400"

export default function DocumentRegistrationForm({ onSubmit }: DocumentRegistrationFormProps) {
  const [values, setValues] = useState(initialValues)
  const [error, setError] = useState<string>()
  const [isPending, startTransition] = useTransition()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isDisabled = isPending || isSubmitting

  return (
    <section className="space-y-5 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/30">
      <div className="space-y-2">
        <p className="text-xs font-semibold tracking-[0.4em] text-cyan-300 uppercase">Document intake</p>
        <h2 className="text-2xl font-semibold text-white">Queue an official manual</h2>
        <p className="text-sm leading-6 text-slate-400">
          Register the vendor, product, and source PDF before ingestion turns the document into grounded evidence.
        </p>
      </div>

      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault()

          const normalizedValues: DocumentFormValues = {
            vendorName: values.vendorName.trim(),
            productName: values.productName.trim(),
            title: values.title.trim(),
            version: values.version.trim(),
            language: values.language.trim(),
            sourceUrl: values.sourceUrl.trim()
          }

          if (!normalizedValues.title || !normalizedValues.sourceUrl) {
            setError("Title and source URL are required.")
            return
          }

          setError(undefined)
          setIsSubmitting(true)

          try {
            await onSubmit(normalizedValues)
            startTransition(() => {
              setValues(initialValues)
            })
          } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "Failed to queue the document.")
          } finally {
            setIsSubmitting(false)
          }
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block space-y-2 text-sm text-slate-200">
            <span>Vendor name</span>
            <input
              className={inputClassName}
              placeholder="Rockwell Automation"
              value={values.vendorName}
              onChange={(event) => setValues((current) => ({ ...current, vendorName: event.target.value }))}
            />
          </label>

          <label className="block space-y-2 text-sm text-slate-200">
            <span>Product name</span>
            <input
              className={inputClassName}
              placeholder="GuardLogix 5570 Controllers"
              value={values.productName}
              onChange={(event) => setValues((current) => ({ ...current, productName: event.target.value }))}
            />
          </label>

          <label className="block space-y-2 text-sm text-slate-200">
            <span>Title</span>
            <input
              className={inputClassName}
              placeholder="GuardLogix 5570 Controllers User Manual"
              value={values.title}
              onChange={(event) => setValues((current) => ({ ...current, title: event.target.value }))}
            />
          </label>

          <label className="block space-y-2 text-sm text-slate-200">
            <span>Version</span>
            <input
              className={inputClassName}
              placeholder="20.01"
              value={values.version}
              onChange={(event) => setValues((current) => ({ ...current, version: event.target.value }))}
            />
          </label>

          <label className="block space-y-2 text-sm text-slate-200 md:col-span-2">
            <span>Language</span>
            <input
              className={inputClassName}
              placeholder="English"
              value={values.language}
              onChange={(event) => setValues((current) => ({ ...current, language: event.target.value }))}
            />
          </label>
        </div>

        <label className="block space-y-2 text-sm text-slate-200">
          <span>Source URL</span>
          <input
            className={inputClassName}
            placeholder="https://.../manual.pdf"
            type="url"
            value={values.sourceUrl}
            onChange={(event) => setValues((current) => ({ ...current, sourceUrl: event.target.value }))}
          />
        </label>

        {error ? (
          <p role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="inline-flex items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 active:translate-y-px disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
            disabled={isDisabled}
            type="submit"
          >
            {isDisabled ? "Queueing..." : "Queue document"}
          </button>
          <p className="text-xs leading-5 text-slate-400">Title and source URL are required before the manual can be queued.</p>
        </div>
      </form>
    </section>
  )
}

import { useState } from "react"

type QuestionComposerProps = {
  disabled?: boolean
  onSubmit: (value: string) => void | Promise<void>
}

const textareaClassName =
  "min-h-36 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400"

export default function QuestionComposer({ disabled, onSubmit }: QuestionComposerProps) {
  const [value, setValue] = useState("")

  return (
    <form
      className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/30"
      onSubmit={(event) => {
        event.preventDefault()

        const submittedValue = value.trim()
        if (!submittedValue) {
          return
        }

        void onSubmit(submittedValue)
        setValue("")
      }}
    >
      <div className="space-y-2">
        <p className="text-xs font-semibold tracking-[0.4em] text-cyan-300 uppercase">Ask assistant</p>
        <h2 className="text-2xl font-semibold text-white">Query the manual corpus</h2>
        <p className="text-sm leading-6 text-slate-400">
          Ask a concrete question about wiring, alarms, safety placement, or page-specific instructions.
        </p>
      </div>

      <label className="block space-y-2 text-sm text-slate-200">
        <span>Question</span>
        <textarea
          className={textareaClassName}
          disabled={disabled}
          placeholder="Describe the hardware issue or ask about a connection rule..."
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          className="inline-flex items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 active:translate-y-px disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
          disabled={disabled || !value.trim()}
          type="submit"
        >
          {disabled ? "Thinking..." : "Ask assistant"}
        </button>
        <p className="text-xs leading-5 text-slate-400">Answers are grounded in official vendor documents only.</p>
      </div>
    </form>
  )
}

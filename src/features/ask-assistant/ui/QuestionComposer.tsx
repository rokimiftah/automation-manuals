import { useState } from "react"

type QuestionComposerProps = {
  disabled?: boolean
  onSubmit: (value: string) => void | Promise<void>
}

const textareaClassName =
  "min-h-[160px] w-full bg-transparent text-[15px] leading-[1.6] text-[#000000] outline-none placeholder:text-[#999999] resize-none font-mono"

export default function QuestionComposer({ disabled, onSubmit }: QuestionComposerProps) {
  const [value, setValue] = useState("")

  return (
    <form
      className="wire-border group relative flex flex-col overflow-hidden bg-white"
      onSubmit={(event) => {
        event.preventDefault()

        const submittedValue = value.trim()
        if (!submittedValue) {
          return
        }

        void (async () => {
          try {
            await onSubmit(submittedValue)
            setValue("")
          } catch {
            // The parent renders the error state. Keep the draft intact.
          }
        })()
      }}
    >
      <div className="flex flex-1 flex-col p-6">
        <textarea
          className={textareaClassName}
          disabled={disabled}
          placeholder="..."
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />

        <div className="wire-border-t mt-auto flex flex-col justify-end gap-6 pt-6 sm:flex-row sm:items-center md:pt-8">
          <button
            className="wire-border w-full bg-white px-8 py-3 text-[12px] font-medium tracking-widest text-[#000000] uppercase transition-colors hover:bg-[#000000] hover:text-white active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 sm:w-auto"
            disabled={disabled || !value.trim()}
            type="submit"
          >
            {disabled ? "Processing..." : "Find Manuals"}
          </button>
        </div>
      </div>
    </form>
  )
}

import { createRequire } from "node:module"

if (typeof document === "undefined") {
  const require = createRequire(import.meta.url)
  const { JSDOM } = require("jsdom") as {
    JSDOM: new (html: string, options: { url: string }) => { window: Window & typeof globalThis }
  }
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" })
  const { window } = dom

  Object.assign(globalThis, {
    document: window.document,
    Event: window.Event,
    HTMLElement: window.HTMLElement,
    MouseEvent: window.MouseEvent,
    Node: window.Node,
    window
  })

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: window.navigator
  })

  const htmlElementPrototype = window.HTMLElement.prototype as HTMLElement & {
    attachEvent?: () => undefined
    detachEvent?: () => undefined
  }

  if (!htmlElementPrototype.attachEvent) {
    Object.defineProperty(htmlElementPrototype, "attachEvent", {
      configurable: true,
      value: () => undefined
    })
  }

  if (!htmlElementPrototype.detachEvent) {
    Object.defineProperty(htmlElementPrototype, "detachEvent", {
      configurable: true,
      value: () => undefined
    })
  }
}

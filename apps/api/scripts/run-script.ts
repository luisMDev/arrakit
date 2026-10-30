import { pathToFileURL } from 'node:url'

/** Runs `main` when the module at `moduleUrl` is the script node was started with. */
export function runScript(moduleUrl: string, main: () => Promise<void>): void {
  if (!process.argv[1] || moduleUrl !== pathToFileURL(process.argv[1]).href) return
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}

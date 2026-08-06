/**
 * The CLI's colour palette, used to carry meaning rather than decoration.
 *
 * Colour is applied only where it says something a reader would otherwise have
 * to parse: which line is progress and which is a result, whether a pool is
 * tradeable, and above all whether a plan is about to spend real funds. Amounts
 * are never coloured — a green number invites a reading ("good", "gain") that the
 * figure does not carry.
 *
 * `styleText` handles the environment: it strips codes when the stream is not a
 * TTY, and honours `NO_COLOR` and `FORCE_COLOR`. So piping to a file, running in
 * CI, and `--json` all come out plain without a check here. `--no-color` is
 * additionally respected for a caller on a TTY who wants none.
 */
import { styleText } from 'node:util'

/** Set from `--no-color`; `styleText` covers NO_COLOR and non-TTY streams itself. */
let disabled = false

/** Turns colour off for the rest of the process. */
export function setNoColor(on: boolean): void {
  disabled = on
}

type Format = Parameters<typeof styleText>[0]

/**
 * Styles text, or returns it unchanged when colour is off.
 *
 * @param format A `styleText` format, or an array of them.
 * @param text The text to style.
 * @param stream Which stream the text is bound for — `styleText` decides whether
 *   to emit codes by inspecting it, so a warning bound for stderr must say so or
 *   it inherits stdout's answer.
 */
function paint(format: Format, text: string, stream: 'stdout' | 'stderr' = 'stdout'): string {
  if (disabled) return text
  return styleText(format, text, { stream: stream === 'stderr' ? process.stderr : process.stdout })
}

/** Secondary text: progress lines, table rules, absent values. */
export const dim = (text: string) => paint('dim', text)
/** A completed step or a healthy state. */
export const green = (text: string) => paint('green', text)
/** Something that did not stop the run but changes what the reader should expect. */
export const yellow = (text: string, stream: 'stdout' | 'stderr' = 'stdout') => paint('yellow', text, stream)
/** A failure, or a state that blocks every operation on the thing described. */
export const red = (text: string, stream: 'stdout' | 'stderr' = 'stdout') => paint('red', text, stream)
/** Column headings, and the one banner that must not be skimmed past. */
export const bold = (text: string) => paint('bold', text)
/** Reserved for the mainnet banner: the only place both weight and colour apply. */
export const alarm = (text: string) => paint(['red', 'bold'], text)
/** A flag name, or a subcommand in the main listing. */
export const cyan = (text: string) => paint('cyan', text)
/**
 * A balance that can fund a trade — the private side.
 *
 * Brighter than {@link green} so the two sides of a balance read apart at a
 * glance: a swap spends records, so this is the figure that decides whether a
 * trade is possible.
 */
export const greenBright = (text: string) => paint('greenBright', text)
/** A balance that cannot fund a trade until it is wrapped or transferred. */
export const greenDim = (text: string) => paint(['green', 'dim'], text)

/**
 * Colours a help screen by its structure, leaving the text itself plain.
 *
 * Applied at print time rather than written into the usage strings, so those stay
 * greppable, diffable, and safe to embed in a JSON error. Every rule keys off
 * shape a help screen already has:
 *
 *   - the first line names the command, so its `shield-swap x` half is bold and
 *     the description after the dash is dim;
 *   - a two-column row beginning with a dash is a flag: the flag names are cyan
 *     and their `<placeholders>` dim;
 *   - a two-column row that does not is a subcommand in the main listing, so the
 *     name is cyan;
 *   - an unindented line ending in a colon heads a section, so it is bold.
 *
 * Prose paragraphs are left alone. Colour here is for scanning to the flag you
 * want, and prose is not something a reader scans for.
 *
 * @param text The plain usage block.
 * @returns The same text with styling applied, or unchanged when colour is off.
 */
export function help(text: string): string {
  if (disabled) return text
  return text
    .split('\n')
    .map((line, index) => {
      if (index === 0) {
        // `shield-swap liquidity — add to or withdraw…`: name bold, summary dim.
        const split = line.indexOf(' — ')
        return split === -1
          ? bold(line)
          : `${bold(line.slice(0, split))}${dim(line.slice(split))}`
      }
      // Two-column rows: the left column is the name, the right its description.
      // Anchored to an indent of exactly two spaces, which is what separates a
      // flag or subcommand from the deeply indented continuation of a description
      // above it — those are prose and must not be read as names.
      const row = /^( {2})(\S.*?)( {2,})(.*)$/.exec(line)
      if (row) {
        const [, indent, name, gap, description] = row as unknown as [string, string, string, string, string]
        const styled = name.startsWith('-')
          ? // Flag names cyan; their `<placeholders>` dim, since those are the part
            // a reader substitutes rather than types.
            name
              .replace(/(-{1,2}[\w-]+)/g, (flag) => cyan(flag))
              .replace(/(<[^>]+>)/g, (placeholder) => dim(placeholder))
          : cyan(name)
        return `${indent}${styled}${gap}${description}`
      }
      // `Usage:` and `Common to every command below setup:` head their sections.
      if (/^\S.*:$/.test(line)) return bold(line)
      return line
    })
    .join('\n')
}

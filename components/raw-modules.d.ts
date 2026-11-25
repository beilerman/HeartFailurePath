// Vite "?raw" imports return the file's text. Used to render docs/evidence-matrix.md in the app
// from the file itself, so there is a single source of truth for the rule-to-evidence rows.
declare module '*.md?raw' {
    const content: string;
    export default content;
}

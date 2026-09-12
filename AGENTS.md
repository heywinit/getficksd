# Repository Guidelines

## UI Themes

- Use the shadcn CSS theme tokens for all interface colors.
- Prefer semantic utilities such as `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, and `text-primary`.
- Use `chart-1` through `chart-5` for categorical visualization colors.
- Do not use Tailwind palette colors or hard-coded color literals in interface components.
- If the interface needs a new semantic color, define its light and dark CSS variables in `packages/ui/src/styles/globals.css`.
- Make sure that interface changes work with both light and dark theme values.

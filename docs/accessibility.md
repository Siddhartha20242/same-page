# Accessibility

This is a review of what we built, checked against the live panel's accessibility tree on 2026-11-06. It is not an audit by an accessibility specialist and no screen reader user has tried the app.

## What holds
- **Nothing is conveyed by color alone.** Severity is always written out (Blocker, Warning, Note) beside its color. Lifecycle steps, verdicts (Blocked, Warning, Clean, Not checked) and the Was and Is now labels are text.
- **Every action is a native button with a text label** that says what it does ("Apply this edit to the page", "Create review task", "Dismiss with a reason…", "Show the ten rules"). None depends on an icon or on hover.
- **Headings give the panel a structure** ("What Same Page checked", "Start here", "Page says", "Jira says"), so it can be navigated by heading.
- **Text fields have a visible label above them** (Target API version, Reason for dismissing this finding) as well as placeholder text.
- **Errors say what happened and what to do**, in plain words, and an error is never shown as a clean result.
- **Keyboard:** Forge UI Kit renders standard controls, so tab order follows the page and buttons work with Enter and Space. We have not tested every flow by keyboard alone.

## What we did not check
- A run with a screen reader (VoiceOver, NVDA).
- Contrast and focus rings. UI Kit controls these, so they follow Atlassian's themes, including dark mode. We did not override them.
- Reflow at very small widths and 200% zoom.
- The Confluence byline modal and the overview page were not run through the same tree check.

## Known gaps
- **Text fields are not programmatically labelled.** We tried an `aria-label` and read the rendered field in the browser: Forge's UI Kit does not pass it through, so a screen reader announces the placeholder text as the field's name. The visible label above each field does not change that.
- The proposed change shows the old and new lines with a highlighted token. The highlight is a lozenge, and the before and after labels carry the meaning, but a screen reader reads the line in pieces.
- Rule descriptions in the Rules list follow the rule name as separate text, not as one grouped item.

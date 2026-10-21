# 17: « Create automation » fails when the Task Page stayed open across a demo reinstall

**Found:** live check (ticket 16), 2026-10-18 09:00.

**Status:** fixed in bcb3e74c0, live check pending

**What happens:** the Task Page was open (from an earlier ⌃⌥⌘D press within
90 s). `reset.ts` cleared the answers and ⌃⌥⌘D reinstalled the demo task in the
catalog, but the open page kept its older copy. After answering both questions,
the first « Create automation » click answered « This workflow changed while you
were answering. Your draft is kept. Review it and save again. » and created
nothing; a second click worked.

**Why it matters:** on stage the app may still show the Task Page from the
previous rehearsal; the first click on « Create automation » then fails in
front of the jury.

**Expected:** opening the Task Page from the notification or the shortcut
always reads the task again, so the first « Create automation » works.
Until fixed, the runbook says: leave the Task Page (go to Chat) before pressing
⌃⌥⌘D, and click « Create automation » again if that message shows.

- [x] Reproduced in a component test (open page, catalog rewritten, create): `components/workflows/task-page-create-flow.test.tsx` « ticket 17 », fails without the fix.
- [x] The page re-reads the task when the demo deeplink or shortcut opens it (every review request reloads the catalog and remounts the Task Page).
- [ ] Live: two rehearsals in a row without leaving the Task Page create the Flow on the first click.

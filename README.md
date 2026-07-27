# Your training log rounds the truth.

**Atomic stores your training at the rep level, the smallest true fact of a workout, in a plain file you own that will outlive any app. Everything else, sets, records, stats, what to lift next, is computed from atoms that never lie.**

**[Open Atomic →](https://aassoiants.github.io/atomic-workout-tracker/)**, it runs in your browser and installs to your home screen. No account, no cloud, your record never leaves your phone.

---

## You've been here

Bench day. The plan said 3×10 at 90. You got 8, then 7, then 4 ugly ones and stripped to 70 to finish. Hard, honest work.

Your tracker wrote `3×10×90`, because you tapped the plan and moved on. Or it wrote `90×8, 90×7, 90×4` and lost the strip set entirely, because there was no box for it. Either way, the log now stores a rounder, cleaner session than the one that happened.

Next week you open the app to load the bar and it cheerfully suggests 95.

The problem isn't discipline. It's the unit. Training happens one rep at a time, but trackers record sets, the unit of the plan rather than the unit of reality. The log keeps a summary in place of the events, and every call you make from it later (am I progressing, what do I load today, is something off) inherits whatever the summary threw away.

## What storing the rep buys you

The set stays cheap to log: weight × reps, two taps. You only pay attention when reality diverges, and then the reps materialize: failed, assisted, partial, dropped to a lighter weight. The record holds what happened, not what was planned.

From there, everything is a computed view:

- **The next card shows its work.** Never advice, always arithmetic you can read: "8 at 90 is about the same strength as 10 at 85, so go down and take every set." A set with a strip or a failed rep counts against a clean exposure, because it should.
- **Declared plans.** Tell an exercise its targets once; the suggestion judges against your plan instead of guessing from history.
- **Stats that answer "where am I".** A dashboard of removable widgets: year heat, weekly wave, tonnage skyline, coverage by muscle, gap counters, records. All derived live from the reps, nothing stored twice.
- **A share card.** One tap turns the session into a clean image for the group chat.
- **Themes.** Volt by default. The pink one is called Berry Dusk and the audience it was built for picked it.

## The file is the point

| Most trackers | Atomic |
|---|---|
| Store sets, the plan's unit | Stores reps, reality's unit |
| Your history lives in their cloud | Your history is a file on your phone |
| Export is a lossy CSV, if it exists | Export is [WODIS](https://github.com/aassoiants/workout-open-data-spec), nothing flattened |
| Gives advice | Shows arithmetic |

Atomic reads and writes [WODIS](https://github.com/aassoiants/workout-open-data-spec), an open JSON spec for workout data where dropsets, supersets, and per-rep detail survive intact. Open the file in a text editor and read your training. Analyze it with anything that reads JSON. If Atomic disappears tomorrow, your record doesn't.

## Install

1. Open **[the app](https://aassoiants.github.io/atomic-workout-tracker/)** on your phone
2. Add to home screen (your browser's menu → "Add to Home Screen" / "Install app")
3. Lift

It works offline from then on. Everything stays on the device: no account, no backend, no analytics, nobody's retention strategy.

## License

The app is source-visible here; the data format is the open part. Take [WODIS](https://github.com/aassoiants/workout-open-data-spec) and build something better than Atomic with it. That's the deal working as intended.

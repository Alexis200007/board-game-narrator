# Roadmap

What makes this app different: it reads **any** game's cards aloud in your language, with a voice per character, and explains the rules from the rulebook you own. Features that strengthen that come first.

Size: **S** about a day, **M** a few days, **L** a week or more.

## 1. Game night never breaks

| Feature | Why | Size |
|---|---|---|
| ✅ Keep the screen on while reading and in voice chat | The phone sleeping cuts the story. Home-screen web apps need iOS 18.4 or later | S |
| Replay cards already read without a connection | Lost service and no downloads are top complaints about narration apps | M |
| Resume reading after a call or an app switch | Same complaint: audio that won't restart | M |
| ✅ Cost meter: per card, per question, per evening | Know what an evening uses | S |

Done when a full evening runs on two phones with no lost card and a known cost.

## 2. Answers you can trust

| Feature | Why | Size |
|---|---|---|
| ✅ Rules test set (`npm run evaluer`): known questions, checked page and answer | Wrong answers given with confidence are the main criticism of AI rules help | M |
| Official FAQ and errata as a separate source, which wins over the rulebook | The rulebook alone gives outdated answers | M |
| Expansions you switch on per group | Answers must match what is on the table | M |
| House rules, always labelled as such | Keeps "official" and "ours" apart | S |
| ✅ "Wrong answer?" button that saves the case to the test set | Quality improves with use | S |

Done when the test set passes at an agreed rate on three very different games.

## 3. Easier at the table

| Feature | Why | Size |
|---|---|---|
| Several photos in a row for long story passages | One book page is rarely the whole scene | M |
| "What is this?": photograph a card or token and ask | Already offered elsewhere; natural next to our reader | M |
| Larger text, stronger contrast, full VoiceOver pass | Many players can't read small cards; tests need real users | M |
| Teach me: short spoken lesson before the first game, with questions | Builds on "My turn" | M |
| Guided setup, step by step, with page pictures | Not found in the apps surveyed | M |
| Follow along: the same card and voice on every phone, or one speaker and several texts | Each player can have their own language | L |

Done when someone new can set up and start a game without reading the rulebook.

## 4. The campaign remembers

| Feature | Why | Size |
|---|---|---|
| Campaign journal: characters, places, promises, open questions | Extends "Previously…" | M |
| Ask the story: "Who was Maren?", without spoilers | Only from cards already read | M |
| Export a session as text or audio | A souvenir, for private use | M |
| Choose a character's voice by hand | Players care about voices | S |

## 5. Other languages

| Feature | Why | Size |
|---|---|---|
| Spanish, then German | Adding a language needs texts, prompts and voices, tested by a native speaker | M each |

## Not planned for now

- **Score tracker, dice, timers, collection:** many good apps already do this.
- **Live AR translation over the camera:** costly, and worse for listening than a clean reading.
- **BoardGameGeek data:** its API has usage conditions, including no AI training. Ask for permission first.
- **A shared library of rulebooks:** copyright. Each player adds their own.
- **Native iOS app:** only if voice chat proves limited in real games.

## Sources (November 2026)

Store pages are developers' own claims. Player complaints come from a few reviews, not a survey.

- Rules assistants: [Board Game Rules AI](https://play.google.com/store/apps/details?id=com.pierogi_attack_studios.boardgamerulesai&hl=en), [BGrules](https://play.google.com/store/apps/details?id=ca.valian.bgrules&hl=en_GB), [Ludomentor](https://play.google.com/store/apps/details?id=com.awakenrealms.ludomentor), [Board Game Wizard](https://board-game-wizard.com/), [Boardgame Librarian](https://boardgamelibrarian.ai/), [Mira](https://miralibrary.com/)
- Card translation: [BoardGamesBot](https://pitchwall.co/product/boardgamesbot)
- Narration: [Forteller](https://apps.apple.com/us/app/forteller/id1495720285)
- AI reliability: [Steve Jackson Games](https://sjgames.com/ill/archive/February_26_2023) (2023), [Digital Trends](https://digitaltrends.com/computing/chatgpt-board-game-night)
- Accessibility: [Chalmers thesis](https://odr.chalmers.se/items/aaa3884f-0a7d-477d-b1ad-f4dec04f72e4/full)
- Game tools: [Board Game Tools & Stats](https://apps.apple.com/us/app/id6759194713)
- Platform: [screen wake lock](https://progressier.com/pwa-capabilities/screen-wake-lock), [iOS web app compatibility](https://firt.dev/notes/pwa-ios/)
- BoardGameGeek: [API terms](https://rpggeek.com/wiki/page/XML_API_Terms_of_Use)

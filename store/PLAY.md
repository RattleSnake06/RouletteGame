# Google Play: the listing and the steps

Everything the Play Console asks for, ready to paste (design doc 9.10,
decision 38). The store graphics come from `npm run store-art` (below); the
privacy policy is `site/privacy.html`, published by GitHub Pages.

## Store listing

**App name** (30 characters at most)

> Rien Ne Va Plus

**Short description** (80 at most)

> A roulette roguelike. Owe the House, build your luck, bank before the Devil.

**Full description** (4,000 at most)

> You wake at a roulette table in a dark hall, under a single bulb. A brass Cage says what you owe the House, and how many nights you have to pay it.
>
> Rien Ne Va Plus is a roulette roguelike. Your chips are yours to keep: a chip on a bet pays when the bet wins and does nothing when it loses. The risk is the coin you pay for every spin. Bank what you win at the Cage before the Devil takes it, and pay the debt before the third night ends. Then a bigger one begins.
>
> BUILD A RUN
> • 83 talismans hang on the rail above the felt and act from left to right: make red pay double, pay straight-ups more, copy a neighbour, feed a pyre.
> • Madame Zero, the automaton fortune teller, deals 31 fortune cards: white ones that help, black ones with a price.
> • 16 records for her gramophone, each with its own tune and one rule that changes while it plays.
> • Reshape the wheel itself: widen a number, paint pockets gold, give a number a second pocket, remove a pocket, change a pocket's number.
>
> PLAY THE ODDS
> • Nudge lets the ball hop pockets toward your chips. Spread your bets around the wheel, not the table.
> • Now and then the House leans, and it tells you one spin early. Plan for it.
> • After a run of misses, the House takes pity.
> • The wheel's numbers add up to 666. Once the Devil wakes, any spin can burn the coins in your hand. Bank before he fires.
>
> KEEP GOING
> • Every debt you pay opens more of the House: four more chip sets, four more starting wheels, five House Edge levels, new talismans, cards and records.
> • Four padlocks hang on the Vault door. Open them all, then the Vault itself, and play on in Endless.
> • Every run that falls leaves its figure standing in the dark. The Almanac remembers them all.
>
> MADE FOR PHONES
> • Built for touch, in landscape, with every control in reach of a thumb.
> • Plays offline. No ads, no in-app purchases, no accounts, no data collected.
>
> Roulette with play money only: the coins in the game have no value outside it, and nothing can be bought or won for real.

**App category:** Game. **Category:** Strategy is the suggestion (Casino would
put it among free slot machines with purchases; Card is where Balatro sits).
**Tags:** Roguelike, Single player, Offline, Stylized.

**Contact details:** an email address is required and shown on the listing.
The website can be the GitHub Pages site (below).

## Graphics

`npm run store-art` renders them from the game itself into `store/out/` (not
kept in the repository; run it again after the game changes):

| File | What Play wants |
|---|---|
| `icon-512.png` | App icon: 512 × 512, 32-bit PNG |
| `feature-1024x500.jpg` | Feature graphic: 1024 × 500, JPEG or 24-bit PNG |
| `phone-1.jpg` … `phone-8.jpg` | Phone screenshots: 2 to 8, 1920 × 1080 (16:9) |

## App content (the Policy section)

- **Privacy policy:** `https://rattlesnake06.github.io/RouletteGame/privacy.html`
  once GitHub Pages is on (below).
- **Ads:** No, the app contains no ads.
- **App access:** All functionality is available without special access.
- **Content rating** (the IARC questionnaire): category Game. Answer **Yes** to
  simulated gambling, **No** to real-money gambling, and No to violence,
  sexuality, language, drugs, user interaction, location sharing and digital
  purchases. The hall is dark and the Devil's blackout is sudden; if the
  questionnaire asks about frightening content, mild horror is the honest
  answer. The rating itself is assigned per region by IARC; simulated
  gambling usually brings a teen-or-older rating.
- **Target audience:** 18 and over only. Simulated gambling keeps it out of
  Google's family programmes, and an adult-only audience avoids their extra
  rules.
- **Data safety:** the app collects no data and shares no data. Answer No to
  "Does your app collect or share any of the required user data types?" (the
  remaining questions then fall away).
- **Government apps, financial features, health:** none.

## Pricing

The design is a one-time price (decision 20). **Choose Paid before the first
release goes to production: Google does not let a free app become paid
later.** A price needs a payments profile linked to the Play Console. Testing
tracks work before any of that is set.

## The upload key and the signed bundle

Play takes an Android App Bundle (`.aab`) signed with your **upload key**.
Google keeps the real app-signing key (Play App Signing, accepted on the first
upload), so a lost upload key can be reset through Play support.

1. **Make the key** once, on any computer with Java (Android Studio includes
   it), and keep the file and its passwords somewhere safe, never in the
   repository:

   ```bash
   keytool -genkeypair -v -keystore upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```

2. **Encode it** as text for GitHub:
   - macOS: `base64 -i upload.keystore | pbcopy`
   - Windows (PowerShell): `[Convert]::ToBase64String([IO.File]::ReadAllBytes("upload.keystore")) | Set-Clipboard`
   - Linux: `base64 -w0 upload.keystore`

3. **Add four repository secrets** (Settings, Secrets and variables, Actions,
   New repository secret): `UPLOAD_KEYSTORE_BASE64` (the encoded text),
   `UPLOAD_KEYSTORE_PASSWORD`, `UPLOAD_KEY_ALIAS` (`upload` above) and
   `UPLOAD_KEY_PASSWORD`.

4. **Build the bundle:** Actions, **Play release bundle**, Run workflow, and
   give the version shown on Play (say `1.0`; the run number is added, so the
   first is `1.0.1`). The signed `.aab` is that run's artifact, kept for a
   week. Each run numbers itself, so every upload is newer than the last.

## The privacy policy on GitHub Pages

Once: Settings, Pages, Build and deployment, Source: **GitHub Actions**. Then
Actions, **Site**, Run workflow. The site is `site/` and redeploys whenever it
changes; the policy is at
`https://rattlesnake06.github.io/RouletteGame/privacy.html`. GitHub Pages is
free for a public repository; a private one needs a paid GitHub plan, or the
site moved to its own small public repository.

## The first upload

1. Play Console, Create app: name **Rien Ne Va Plus**, language English, Game,
   Paid (see Pricing).
2. Testing, **Internal testing**, Create new release, accept Play App Signing,
   upload the `.aab`, and add yourself and up to 100 testers by email. Internal
   testing is live in minutes with no review wait.
3. A **new personal developer account** must run a **closed test with at
   least 12 testers who stay opted in for 14 days** before it can apply for
   production. Plan for those two weeks.
4. The debug test builds (the Android test build release) are signed with a
   different key, so uninstall one before installing from Play.

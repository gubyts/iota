// Curated list of widely-encountered domains. Used to fuzzy-correct OCR output
// when Tesseract swaps similar-looking characters or fuses a favicon glyph into
// the leading letter. Entries are stored without protocol or path.
//
// This isn't exhaustive — it's the realistic universe of pages people aim a
// phone camera at. Edit-distance correction catches close misses; if a real
// site isn't in the list, the un-corrected candidate still goes through the
// rest of the pipeline unchanged.

const DOMAINS = [
  // search / portals / wiki
  "google.com", "google.co.uk", "google.ca", "google.de", "google.fr", "google.com.au",
  "bing.com", "duckduckgo.com", "kagi.com", "yahoo.com", "yandex.com", "baidu.com",
  "wikipedia.org", "en.wikipedia.org", "wiktionary.org", "wikimedia.org", "wikihow.com",
  "archive.org", "web.archive.org", "archive.is", "archive.ph",

  // big tech / company sites
  "apple.com", "microsoft.com", "amazon.com", "amazon.co.uk", "amazon.de", "amazon.ca",
  "meta.com", "facebook.com", "instagram.com", "threads.net", "whatsapp.com",
  "x.com", "twitter.com", "linkedin.com", "tiktok.com", "snapchat.com", "pinterest.com",
  "youtube.com", "youtu.be", "vimeo.com", "twitch.tv", "kick.com",
  "netflix.com", "disneyplus.com", "hulu.com", "max.com", "hbo.com", "paramountplus.com",
  "peacocktv.com", "appletv.com", "primevideo.com", "spotify.com", "soundcloud.com",
  "bandcamp.com", "tidal.com", "deezer.com", "pandora.com",

  // ai / tools
  "anthropic.com", "claude.ai", "openai.com", "chat.openai.com", "chatgpt.com",
  "perplexity.ai", "gemini.google.com", "bard.google.com", "copilot.microsoft.com",
  "huggingface.co", "midjourney.com", "stability.ai", "runwayml.com", "replicate.com",
  "elevenlabs.io", "character.ai", "poe.com", "you.com", "phind.com",

  // dev / code / docs
  "github.com", "gist.github.com", "raw.githubusercontent.com", "gitlab.com",
  "bitbucket.org", "codeberg.org", "sourcehut.org", "sr.ht",
  "stackoverflow.com", "stackexchange.com", "superuser.com", "serverfault.com",
  "askubuntu.com", "mathoverflow.net", "developer.mozilla.org", "mdn.io",
  "npmjs.com", "pypi.org", "rubygems.org", "crates.io", "pkg.go.dev", "docs.rs",
  "readthedocs.io", "readthedocs.org", "docs.python.org", "nodejs.org", "deno.com",
  "bun.sh", "go.dev", "rust-lang.org", "kotlinlang.org", "swift.org", "scala-lang.org",
  "typescriptlang.org", "javascript.info", "reactjs.org", "react.dev", "vuejs.org",
  "angular.io", "svelte.dev", "solidjs.com", "nextjs.org", "vercel.com", "netlify.com",
  "cloudflare.com", "developers.cloudflare.com", "render.com", "fly.io", "railway.app",
  "digitalocean.com", "linode.com", "akamai.com", "fastly.com",
  "aws.amazon.com", "cloud.google.com", "azure.microsoft.com", "supabase.com",
  "firebase.google.com", "mongodb.com", "redis.io", "postgresql.org", "mysql.com",
  "sqlite.org", "elastic.co", "kafka.apache.org", "apache.org", "nginx.org",
  "docker.com", "hub.docker.com", "kubernetes.io", "k8s.io", "terraform.io",
  "hashicorp.com", "ansible.com", "stripe.com", "twilio.com", "sendgrid.com",
  "auth0.com", "okta.com", "datadoghq.com", "newrelic.com", "sentry.io", "rollbar.com",
  "segment.com", "mixpanel.com", "amplitude.com", "posthog.com", "plausible.io",
  "fathom.com", "linear.app", "notion.so", "asana.com", "trello.com", "atlassian.com",
  "jira.com", "confluence.com", "monday.com", "clickup.com", "airtable.com",
  "figma.com", "framer.com", "sketch.com", "invisionapp.com", "miro.com",
  "canva.com", "adobe.com", "behance.net", "dribbble.com",
  "discord.com", "slack.com", "zoom.us", "webex.com", "teams.microsoft.com",
  "loom.com", "calendly.com", "doodle.com", "tldraw.com", "excalidraw.com",

  // news — major US
  "nytimes.com", "washingtonpost.com", "wsj.com", "usatoday.com", "latimes.com",
  "chicagotribune.com", "bostonglobe.com", "sfgate.com", "sfchronicle.com",
  "nypost.com", "nydailynews.com", "newsday.com", "miamiherald.com", "dallasnews.com",
  "houstonchronicle.com", "denverpost.com", "seattletimes.com", "ajc.com",
  "cnn.com", "foxnews.com", "msnbc.com", "nbcnews.com", "cbsnews.com", "abcnews.go.com",
  "npr.org", "pbs.org", "voanews.com", "axios.com", "politico.com", "thehill.com",
  "huffpost.com", "huffingtonpost.com", "salon.com", "slate.com", "vox.com",
  "buzzfeed.com", "buzzfeednews.com", "vice.com", "motherjones.com", "theintercept.com",
  "propublica.org", "thedailybeast.com", "newrepublic.com", "thenation.com",
  "nationalreview.com", "weeklystandard.com", "reason.com", "theblaze.com",
  "breitbart.com", "dailycaller.com", "newsmax.com", "oann.com",

  // news — international
  "bbc.com", "bbc.co.uk", "theguardian.com", "telegraph.co.uk", "thetimes.co.uk",
  "independent.co.uk", "dailymail.co.uk", "thesun.co.uk", "mirror.co.uk",
  "ft.com", "economist.com", "spectator.co.uk", "newstatesman.com", "metro.co.uk",
  "reuters.com", "apnews.com", "bloomberg.com", "afp.com",
  "lemonde.fr", "lefigaro.fr", "liberation.fr", "leparisien.fr", "spiegel.de",
  "zeit.de", "faz.net", "sueddeutsche.de", "welt.de", "bild.de", "tagesschau.de",
  "elpais.com", "elmundo.es", "abc.es", "lavanguardia.com",
  "corriere.it", "repubblica.it", "ilmessaggero.it", "ansa.it",
  "globalnews.ca", "cbc.ca", "ctvnews.ca", "theglobeandmail.com", "nationalpost.com",
  "abc.net.au", "smh.com.au", "theage.com.au", "news.com.au", "theaustralian.com.au",
  "japantimes.co.jp", "asahi.com", "yomiuri.co.jp", "mainichi.jp",
  "scmp.com", "channelnewsasia.com", "straitstimes.com",
  "aljazeera.com", "haaretz.com", "timesofisrael.com", "jpost.com",
  "rt.com", "tass.com", "kyivindependent.com",

  // magazines / longform
  "theatlantic.com", "newyorker.com", "vanityfair.com", "harpers.org", "harpersbazaar.com",
  "vogue.com", "gq.com", "esquire.com", "elle.com", "wired.com", "thecut.com",
  "newyorkmag.com", "nymag.com", "vulture.com", "grubstreet.com", "intelligencer.com",
  "longreads.com", "theconversation.com", "aeon.co", "psyche.co", "nautil.us",
  "lithub.com", "publicbooks.org", "lrb.co.uk", "nybooks.com",
  "smithsonianmag.com", "nationalgeographic.com", "atlasobscura.com", "mentalfloss.com",
  "history.com", "bigthink.com", "openculture.com", "kottke.org",

  // tech / gadget press
  "theverge.com", "techcrunch.com", "arstechnica.com", "engadget.com", "gizmodo.com",
  "mashable.com", "cnet.com", "zdnet.com", "venturebeat.com", "theregister.com",
  "tomshardware.com", "anandtech.com", "tomsguide.com", "techradar.com", "pcmag.com",
  "pcworld.com", "macworld.com", "9to5mac.com", "9to5google.com", "macrumors.com",
  "appleinsider.com", "androidauthority.com", "androidpolice.com", "androidcentral.com",
  "xda-developers.com", "howtogeek.com", "lifehacker.com", "makeuseof.com",
  "theinformation.com", "stratechery.com", "platformer.news", "bensbites.com",
  "tldr.tech", "hackernoon.com",

  // niche news / aggregators
  "studyfinds.org", "studyfinds.com", "futurism.com", "newatlas.com", "popsci.com",
  "popularmechanics.com", "scientificamerican.com", "sciam.com", "nature.com",
  "science.org", "sciencedaily.com", "sciencenews.org", "livescience.com", "space.com",
  "phys.org", "nasa.gov", "esa.int", "noaa.gov", "usgs.gov",
  "statnews.com", "healthline.com", "webmd.com", "medicalnewstoday.com",
  "mayoclinic.org", "clevelandclinic.org", "hopkinsmedicine.org", "medlineplus.gov",
  "cdc.gov", "who.int", "nih.gov", "fda.gov", "nejm.org", "jamanetwork.com",
  "thelancet.com", "bmj.com",

  // entertainment / culture
  "rollingstone.com", "billboard.com", "pitchfork.com", "stereogum.com", "consequence.net",
  "spin.com", "nme.com", "thefader.com",
  "deadline.com", "variety.com", "hollywoodreporter.com", "ew.com", "indiewire.com",
  "imdb.com", "rottentomatoes.com", "metacritic.com", "letterboxd.com",
  "people.com", "usmagazine.com", "eonline.com", "etonline.com", "tmz.com",
  "polygon.com", "kotaku.com", "ign.com", "gamespot.com", "pcgamer.com",
  "rockpapershotgun.com", "eurogamer.net", "destructoid.com", "videogameschronicle.com",

  // forums / community
  "reddit.com", "old.reddit.com", "news.ycombinator.com", "ycombinator.com",
  "lobste.rs", "tildes.net", "metafilter.com", "fark.com",
  "quora.com", "medium.com", "substack.com", "ghost.org", "wordpress.com",
  "tumblr.com", "blogspot.com", "livejournal.com", "dreamwidth.org",
  "fandom.com", "wikia.com", "tvtropes.org",

  // shopping / commerce
  "ebay.com", "etsy.com", "walmart.com", "target.com", "costco.com", "bestbuy.com",
  "homedepot.com", "lowes.com", "ikea.com", "wayfair.com", "overstock.com",
  "newegg.com", "bhphotovideo.com", "adorama.com", "rei.com", "patagonia.com",
  "uniqlo.com", "zara.com", "hm.com", "gap.com", "nike.com", "adidas.com",
  "shopify.com", "shop.app", "alibaba.com", "aliexpress.com", "temu.com", "shein.com",
  "wish.com", "wayfair.com",

  // travel
  "expedia.com", "kayak.com", "booking.com", "hotels.com", "airbnb.com", "vrbo.com",
  "tripadvisor.com", "priceline.com", "orbitz.com", "skyscanner.com", "google.com/flights",
  "united.com", "delta.com", "aa.com", "southwest.com", "jetblue.com", "alaskaair.com",
  "ba.com", "lufthansa.com", "klm.com", "airfrance.com", "emirates.com", "qatarairways.com",
  "marriott.com", "hilton.com", "hyatt.com", "ihg.com",

  // food / recipes
  "allrecipes.com", "foodnetwork.com", "epicurious.com", "bonappetit.com", "seriouseats.com",
  "tasty.co", "delish.com", "thekitchn.com", "smittenkitchen.com", "nytcooking.com",
  "cooking.nytimes.com", "food52.com", "kingarthurbaking.com", "americastestkitchen.com",
  "yelp.com", "opentable.com", "doordash.com", "ubereats.com", "grubhub.com",
  "postmates.com", "instacart.com",

  // finance / banking
  "chase.com", "bankofamerica.com", "wellsfargo.com", "citi.com", "capitalone.com",
  "usbank.com", "americanexpress.com", "discover.com", "ally.com", "schwab.com",
  "fidelity.com", "vanguard.com", "etrade.com", "robinhood.com", "coinbase.com",
  "binance.com", "kraken.com", "paypal.com", "venmo.com", "cash.app", "wise.com",
  "stripe.com", "square.com",
  "marketwatch.com", "investopedia.com", "morningstar.com", "seekingalpha.com",
  "motleyfool.com", "thestreet.com", "barrons.com", "kiplinger.com",
  "yahoo.com/finance", "finance.yahoo.com", "google.com/finance",

  // sports
  "espn.com", "espn.go.com", "si.com", "bleacherreport.com", "theathletic.com",
  "sbnation.com", "deadspin.com", "yardbarker.com", "cbssports.com", "foxsports.com",
  "nbcsports.com", "nfl.com", "nba.com", "mlb.com", "nhl.com", "fifa.com", "uefa.com",
  "premierleague.com", "skysports.com", "bbc.com/sport", "goal.com", "espnfc.com",
  "formula1.com", "motorsport.com", "atptour.com", "wtatennis.com", "pgatour.com",

  // government / official
  "whitehouse.gov", "congress.gov", "senate.gov", "house.gov", "supremecourt.gov",
  "irs.gov", "usa.gov", "uspto.gov", "sec.gov", "treasury.gov", "state.gov",
  "defense.gov", "dot.gov", "energy.gov", "epa.gov", "fcc.gov", "ftc.gov",
  "uscis.gov", "tsa.gov", "ssa.gov", "va.gov", "gov.uk", "europa.eu", "un.org",

  // education / academic
  "harvard.edu", "mit.edu", "stanford.edu", "berkeley.edu", "princeton.edu",
  "yale.edu", "columbia.edu", "cornell.edu", "upenn.edu", "uchicago.edu",
  "ox.ac.uk", "cam.ac.uk", "ucl.ac.uk", "imperial.ac.uk", "ed.ac.uk",
  "khanacademy.org", "coursera.org", "edx.org", "udemy.com", "udacity.com",
  "duolingo.com", "brilliant.org", "skillshare.com", "masterclass.com",
  "scholar.google.com", "arxiv.org", "biorxiv.org", "ssrn.com", "researchgate.net",
  "academia.edu", "jstor.org", "pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov",

  // misc widely used
  "craigslist.org", "nextdoor.com", "indeed.com", "linkedin.com", "glassdoor.com",
  "ziprecruiter.com", "monster.com", "weworkremotely.com", "stackoverflow.com/jobs",
  "patreon.com", "kickstarter.com", "indiegogo.com", "gofundme.com", "buymeacoffee.com",
  "ko-fi.com",
  "weather.com", "wunderground.com", "accuweather.com", "weather.gov",
  "maps.google.com", "openstreetmap.org", "waze.com",
  "speedtest.net", "fast.com", "haveibeenpwned.com",
  "1password.com", "lastpass.com", "bitwarden.com", "dashlane.com",
  "protonmail.com", "proton.me", "gmail.com", "outlook.com", "icloud.com",
  "dropbox.com", "drive.google.com", "onedrive.live.com", "box.com", "mega.nz",
  "wetransfer.com",
  "goodreads.com", "librarything.com", "openlibrary.org", "gutenberg.org",
  "duckduckgo.com", "kagi.com", "mojeek.com", "marginalia.nu",
];

// Map keyed by length bucket so we only compare candidates against domains of
// similar length. Keeps the per-OCR-result cost well under 5ms even with the
// dictionary at a few thousand entries.
const BY_LENGTH = (() => {
  const m = new Map();
  for (const d of DOMAINS) {
    const len = d.length;
    if (!m.has(len)) m.set(len, []);
    m.get(len).push(d);
  }
  return m;
})();

export const TOP_DOMAINS = new Set(DOMAINS);

// Damerau-Levenshtein with a max-distance early exit. Returns Infinity if the
// distance exceeds maxDist; otherwise returns the actual distance. Handles
// transposition (the "ab" <-> "ba" swap) which is the most common OCR error.
function damerauLev(a, b, maxDist) {
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > maxDist) return Infinity;
  if (a === b) return 0;

  // two-row rolling DP plus one extra row for transposition
  const inf = maxDist + 1;
  let prev2 = new Array(bl + 1);
  let prev1 = new Array(bl + 1);
  let curr  = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev1[j] = j;

  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const lo = Math.max(1, i - maxDist);
    const hi = Math.min(bl, i + maxDist);
    if (lo > 1) curr[lo - 1] = inf;
    for (let j = lo; j <= hi; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(
        prev1[j] + 1,           // deletion
        curr[j - 1] + 1,        // insertion
        prev1[j - 1] + cost,    // substitution
      );
      if (
        i > 1 && j > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        v = Math.min(v, prev2[j - 2] + 1); // transposition
      }
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (hi < bl) curr[hi + 1] = inf;
    if (rowMin > maxDist) return Infinity;
    [prev2, prev1, curr] = [prev1, curr, prev2];
  }
  const d = prev1[bl];
  return d > maxDist ? Infinity : d;
}

// Try to map a hostname to a known domain. Returns { host, dist } where dist
// is 0 for an exact match (or a subdomain of a known apex — "do not rewrite"),
// 1-2 for a fuzzy correction, or null if no candidate is within edit distance 2.
export function correctDomain(host) {
  if (!host) return null;
  const lower = host.toLowerCase();
  if (TOP_DOMAINS.has(lower)) return { host: lower, dist: 0 };

  // If the input is a subdomain of a known apex (e.g. tv.youtube.com under
  // youtube.com), leave it alone. Without this short-circuit the fuzzy matcher
  // would treat "tv.youtube.com" as 2 deletions away from "youtube.com" and
  // collapse the subdomain. Returning dist:0 tells the caller "do not rewrite".
  const labels = lower.split(".");
  for (let i = 1; i < labels.length - 1; i++) {
    if (TOP_DOMAINS.has(labels.slice(i).join("."))) {
      return { host: lower, dist: 0 };
    }
  }

  const dotCount = labels.length - 1;
  const len = lower.length;
  let best = null, bestD = 3;
  for (let dl = Math.max(1, len - 2); dl <= len + 2; dl++) {
    const bucket = BY_LENGTH.get(dl);
    if (!bucket) continue;
    for (const cand of bucket) {
      // Same domain structure (label count) — belt-and-suspenders to keep
      // subdomains from collapsing to apexes if the subdomain check above
      // missed (e.g. unknown subdomain under unknown apex).
      if ((cand.match(/\./g) || []).length !== dotCount) continue;
      const d = damerauLev(lower, cand, bestD - 1);
      if (d < bestD) {
        bestD = d;
        best = cand;
        if (d === 0) return { host: cand, dist: 0 };
      }
    }
  }
  return best ? { host: best, dist: bestD } : null;
}

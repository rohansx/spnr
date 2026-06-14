#!/usr/bin/env python3
"""Generate personalized spnr advertiser-outreach copy for the OutreachDB list.

Input : data/part1.tsv .. part3.tsv  (lines: "<id> <email> <origin> <category>")
Output: spnr_outreach.json           (one record per row, with pitch copy)

Personalization = curated company knowledge + sector inference (no live web),
with the pitch angle tailored per recipient category. Obvious junk/test/
free-mail/placeholder/duplicate rows are flagged send=false with a reason.
"""
import json, re, os, glob

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT  = os.path.join(HERE, "spnr_outreach.json")

ORIGIN = {"IN": "India", "USG": "US / Global", "GLB": "Global / Unknown", "YC": "YC Startup"}
CATEGORY = {"L": "Leadership", "H": "HR / Talent", "I": "Individual", "PI": "Individual", "G": "General"}

# ---------------------------------------------------------------- junk rules
FREEMAIL = {"gmail.com", "yahoo.com", "hotmail.com", "icloud.com", "proton.me",
            "protonmail.com", "gmail.com.with"}
PLACEHOLDER = {"company.com", "email.com", "email.address", "yourname.com",
               "yourdomain.com", "co.com", "clwnt.com", "example.com", "yourdomain.com"}
AGENT_INBOX = {"agent.mailboxkit.com", "agentlair.dev", "agentmailr.com"}

def classify_junk(email, local, domain):
    if domain in FREEMAIL or domain.endswith(".with"):
        return "personal/free-mail address — no company domain to advertise to"
    if domain in PLACEHOLDER:
        return "placeholder/sample address — not a real recipient"
    if domain.endswith("mail-tester.com") or domain.endswith("mailgenius.com"):
        return "deliverability test inbox — not a real prospect"
    if domain in AGENT_INBOX:
        return "automated agent / test inbox — not a real prospect"
    if local.startswith("test-") or local.startswith("preview_"):
        return "malformed / preview test address"
    return None

# ---------------------------------------------------------------- angle rules
RECRUIT_EXACT = {"hr", "people", "ta", "indiahr", "nyjobs", "resumes", "roles",
                 "join", "joinus", "apply", "applications", "eng-jobs"}
def is_recruit(local):
    l = local.lower()
    if l in RECRUIT_EXACT:
        return True
    for p in ("career", "job", "hiring", "hire", "recruit", "talent", "campus", "intern"):
        if l.startswith(p):
            return True
    return False

EXEC_BIZ = {"founders", "founder", "ceo", "cto", "press", "media", "info", "contact",
            "hello", "team", "sales", "startups", "enterprise", "support", "ask",
            "privacy", "solutions", "product", "developers", "developer", "universe",
            "symposium", "summit", "sponsorships", "pr", "pressoffice", "service",
            "software", "tooling", "cloud", "video", "howdy", "hn"}

# ---------------------------------------------------------------- knowledge base
# domain -> (Display Name, sector)
KNOWN = {
    # AI infra / model / compute
    "openai.com": ("OpenAI", "ai-model"), "anthropic.com": ("Anthropic", "ai-model"),
    "cohere.com": ("Cohere", "ai-model"), "mistral.ai": ("Mistral AI", "ai-model"),
    "huggingface.co": ("Hugging Face", "ai-infra"), "together.ai": ("Together AI", "ai-infra"),
    "fireworks.ai": ("Fireworks AI", "ai-infra"), "modal.com": ("Modal", "ai-infra"),
    "baseten.co": ("Baseten", "ai-infra"), "replicate.com": ("Replicate", "ai-infra"),
    "anyscale.com": ("Anyscale", "ai-infra"), "runpod.io": ("RunPod", "ai-infra"),
    "cerebras.net": ("Cerebras", "ai-infra"), "sambanova.ai": ("SambaNova", "ai-infra"),
    "lambdalabs.com": ("Lambda", "ai-infra"), "coreweave.com": ("CoreWeave", "ai-infra"),
    "nebius.ai": ("Nebius", "ai-infra"), "octoml.ai": ("OctoML", "ai-infra"),
    "modular.com": ("Modular", "ai-infra"), "fal.ai": ("fal", "ai-infra"),
    "ollama.com": ("Ollama", "ai-infra"), "unsloth.ai": ("Unsloth", "ai-infra"),
    "lamini.ai": ("Lamini", "ai-infra"), "d-matrix.ai": ("d-Matrix", "ai-infra"),
    "perplexity.ai": ("Perplexity", "ai-app"), "you.com": ("You.com", "ai-app"),
    "character.ai": ("Character.AI", "ai-app"), "phind.com": ("Phind", "ai-app"),
    "scale.com": ("Scale AI", "ai-infra"), "ai21.com": ("AI21 Labs", "ai-model"),
    "reka.ai": ("Reka", "ai-model"), "sakana.ai": ("Sakana AI", "ai-model"),
    "contextual.ai": ("Contextual AI", "ai-model"), "essential.ai": ("Essential AI", "ai-model"),
    "imbue.com": ("Imbue", "ai-model"), "poolside.ai": ("Poolside", "ai-model"),
    "ssi.inc": ("SSI", "ai-model"), "adept.ai": ("Adept", "ai-model"),
    "evolutionaryscale.ai": ("EvolutionaryScale", "ai-model"),
    # dev tools / coding agents
    "cursor.com": ("Cursor", "devtools"), "cursor.sh": ("Cursor", "devtools"),
    "anysphere.co": ("Anysphere (Cursor)", "devtools"), "codeium.com": ("Codeium", "devtools"),
    "magic.dev": ("Magic", "devtools"), "cognition-labs.com": ("Cognition", "devtools"),
    "cognition.ai": ("Cognition", "devtools"), "supermaven.com": ("Supermaven", "devtools"),
    "replit.com": ("Replit", "devtools"), "sourcegraph.com": ("Sourcegraph", "devtools"),
    "sweep.dev": ("Sweep", "devtools"), "bloop.ai": ("bloop", "devtools"),
    "greptile.com": ("Greptile", "devtools"), "coderabbit.ai": ("CodeRabbit", "devtools"),
    "codegen.com": ("Codegen", "devtools"), "augmentinc.com": ("Augment", "devtools"),
    "continue.dev": ("Continue", "devtools"), "lovable.dev": ("Lovable", "devtools"),
    "gitpod.io": ("Gitpod", "devtools"), "daytona.io": ("Daytona", "devtools"),
    "e2b.dev": ("E2B", "devtools"), "github.com": ("GitHub", "devtools"),
    "gitlab.com": ("GitLab", "devtools"), "graphite.dev": ("Graphite", "devtools"),
    "raycast.com": ("Raycast", "devtools"), "warp.dev": ("Warp", "devtools"),
    "mutable.ai": ("Mutable.ai", "devtools"), "void.editor": ("Void", "devtools"),
    "browserbase.com": ("Browserbase", "devtools"), "hyperbrowser.ai": ("Hyperbrowser", "devtools"),
    "firecrawl.dev": ("Firecrawl", "devtools"), "exa.ai": ("Exa", "devtools"),
    "tavily.com": ("Tavily", "devtools"), "composio.dev": ("Composio", "devtools"),
    # agent frameworks / agentic
    "crewai.com": ("CrewAI", "agents"), "langchain.dev": ("LangChain", "agents"),
    "langchain.com": ("LangChain", "agents"), "llamaindex.ai": ("LlamaIndex", "agents"),
    "mem0.ai": ("Mem0", "agents"), "phidata.com": ("Phidata", "agents"),
    "julep.ai": ("Julep", "agents"), "gumloop.com": ("Gumloop", "agents"),
    "skyvern.com": ("Skyvern", "agents"), "lindy.ai": ("Lindy", "agents"),
    "multion.ai": ("MultiOn", "agents"), "n8n.io": ("n8n", "agents"),
    "wordware.ai": ("Wordware", "agents"), "bardeen.ai": ("Bardeen", "agents"),
    "superagi.com": ("SuperAGI", "agents"), "lyzr.ai": ("Lyzr", "agents"),
    "mastra.ai": ("Mastra", "agents"), "vapi.ai": ("Vapi", "voice-ai"),
    "retellai.com": ("Retell AI", "voice-ai"), "bland.ai": ("Bland", "voice-ai"),
    # vector / data / observability
    "pinecone.io": ("Pinecone", "vectordb"), "weaviate.io": ("Weaviate", "vectordb"),
    "qdrant.com": ("Qdrant", "vectordb"), "qdrant.tech": ("Qdrant", "vectordb"),
    "trychroma.com": ("Chroma", "vectordb"), "zilliz.com": ("Zilliz", "vectordb"),
    "databricks.com": ("Databricks", "data"), "snowflake.com": ("Snowflake", "data"),
    "getdbt.com": ("dbt Labs", "data"), "airbyte.io": ("Airbyte", "data"),
    "dagster.io": ("Dagster", "data"), "prefect.io": ("Prefect", "data"),
    "motherduck.com": ("MotherDuck", "data"), "hex.tech": ("Hex", "data"),
    "neo4j.com": ("Neo4j", "data"), "singlestore.com": ("SingleStore", "data"),
    "redis.com": ("Redis", "data"), "datastax.com": ("DataStax", "data"),
    "atlan.com": ("Atlan", "data"), "unstructured.io": ("Unstructured", "data"),
    "sentry.io": ("Sentry", "observability"), "honeycomb.io": ("Honeycomb", "observability"),
    "grafana.com": ("Grafana Labs", "observability"), "signoz.io": ("SigNoz", "observability"),
    "wandb.com": ("Weights & Biases", "observability"), "arize.com": ("Arize", "observability"),
    "fiddler.ai": ("Fiddler", "observability"), "helicone.ai": ("Helicone", "observability"),
    "braintrustdata.com": ("Braintrust", "observability"), "comet.ml": ("Comet", "observability"),
    "galileo.ai": ("Galileo", "observability"), "rungalileo.io": ("Galileo", "observability"),
    "humanloop.com": ("Humanloop", "observability"), "promptlayer.com": ("PromptLayer", "observability"),
    "vellum.ai": ("Vellum", "observability"), "athina.ai": ("Athina", "observability"),
    "lmnr.ai": ("Laminar", "observability"), "litellm.ai": ("LiteLLM", "ai-infra"),
    "portkey.ai": ("Portkey", "ai-infra"), "deepchecks.com": ("Deepchecks", "observability"),
    "giskard.ai": ("Giskard", "observability"), "arthur.ai": ("Arthur", "observability"),
    # cloud / infra / backend
    "vercel.com": ("Vercel", "cloud"), "render.com": ("Render", "cloud"),
    "railway.app": ("Railway", "cloud"), "fly.io": ("Fly.io", "cloud"),
    "supabase.com": ("Supabase", "cloud"), "neon.tech": ("Neon", "cloud"),
    "turso.tech": ("Turso", "cloud"), "upstash.com": ("Upstash", "cloud"),
    "clerk.com": ("Clerk", "cloud"), "appwrite.io": ("Appwrite", "cloud"),
    "hasura.io": ("Hasura", "cloud"), "apollographql.com": ("Apollo GraphQL", "cloud"),
    "prisma.io": ("Prisma", "cloud"), "supertokens.com": ("SuperTokens", "cloud"),
    "ubicloud.com": ("Ubicloud", "cloud"), "digitalocean.com": ("DigitalOcean", "cloud"),
    "cloudflare.com": ("Cloudflare", "cloud"), "vultr.com": ("Vultr", "cloud"),
    "docker.com": ("Docker", "devtools"), "hashicorp.com": ("HashiCorp", "cloud"),
    "pydantic.dev": ("Pydantic", "devtools"), "tiangolo.com": ("FastAPI / tiangolo", "devtools"),
    "gradio.app": ("Gradio", "devtools"), "streamlit.io": ("Streamlit", "devtools"),
    "inngest.com": ("Inngest", "devtools"), "trigger.dev": ("Trigger.dev", "devtools"),
    "hatchet.run": ("Hatchet", "devtools"), "resend.com": ("Resend", "devtools"),
    "dub.co": ("Dub", "devtools"), "posthog.com": ("PostHog", "observability"),
    "mintlify.com": ("Mintlify", "devtools"), "gitbook.com": ("GitBook", "devtools"),
    "elastic.co": ("Elastic", "observability"), "redhat.com": ("Red Hat", "devtools"),
    # security
    "okta.com": ("Okta", "security"), "vanta.com": ("Vanta", "security"),
    "castle.io": ("Castle", "security"), "cloudsek.com": ("CloudSEK", "security"),
    "zscaler.com": ("Zscaler", "security"), "securin.io": ("Securin", "security"),
    "spin.ai": ("Spin.AI", "security"), "eclypsium.com": ("Eclypsium", "security"),
    "opsinsecurity.com": ("Ops In Security", "security"),
    # voice / video / image / media AI
    "elevenlabs.io": ("ElevenLabs", "voice-ai"), "deepgram.com": ("Deepgram", "voice-ai"),
    "play.ht": ("PlayHT", "voice-ai"), "resemble.ai": ("Resemble AI", "voice-ai"),
    "wellsaidlabs.com": ("WellSaid Labs", "voice-ai"), "cartesia.ai": ("Cartesia", "voice-ai"),
    "polyai.com": ("PolyAI", "voice-ai"), "murf.ai": ("Murf AI", "voice-ai"),
    "smallest.ai": ("Smallest AI", "voice-ai"), "gan.ai": ("Gan.ai", "voice-ai"),
    "suno.ai": ("Suno", "audio-ai"), "suno.com": ("Suno", "audio-ai"),
    "udio.com": ("Udio", "audio-ai"), "beatoven.ai": ("Beatoven.ai", "audio-ai"),
    "runwayml.com": ("Runway", "video-ai"), "pika.art": ("Pika", "video-ai"),
    "lumalabs.ai": ("Luma AI", "video-ai"), "heygen.com": ("HeyGen", "video-ai"),
    "synthesia.io": ("Synthesia", "video-ai"), "tavus.io": ("Tavus", "video-ai"),
    "captions.ai": ("Captions", "video-ai"), "descript.com": ("Descript", "video-ai"),
    "invideo.io": ("InVideo", "video-ai"), "dubverse.ai": ("Dubverse", "video-ai"),
    "midjourney.com": ("Midjourney", "image-ai"), "stability.ai": ("Stability AI", "image-ai"),
    "ideogram.ai": ("Ideogram", "image-ai"), "leonardo.ai": ("Leonardo.AI", "image-ai"),
    "krea.ai": ("Krea", "image-ai"), "phot.ai": ("Phot.AI", "image-ai"),
    "neuralgarage.com": ("NeuralGarage", "video-ai"),
    # writing / content / productivity AI
    "writer.com": ("Writer", "ai-app"), "typeface.ai": ("Typeface", "ai-app"),
    "jasper.ai": ("Jasper", "ai-app"), "copy.ai": ("Copy.ai", "ai-app"),
    "sudowrite.com": ("Sudowrite", "ai-app"), "writesonic.com": ("Writesonic", "ai-app"),
    "tome.app": ("Tome", "ai-app"), "gamma.app": ("Gamma", "ai-app"),
    "usemotion.com": ("Motion", "saas"), "hebbia.ai": ("Hebbia", "ai-app"),
    "glean.com": ("Glean", "ai-app"), "harvey.ai": ("Harvey", "ai-app"),
    # robotics / frontier / hardware
    "figure.ai": ("Figure", "robotics"), "skild.ai": ("Skild AI", "robotics"),
    "physicalintelligence.company": ("Physical Intelligence", "robotics"),
    "covariant.ai": ("Covariant", "robotics"), "waabi.ai": ("Waabi", "robotics"),
    "wayve.ai": ("Wayve", "robotics"), "comma.ai": ("comma.ai", "robotics"),
    "extropic.ai": ("Extropic", "ai-infra"), "symbolica.ai": ("Symbolica", "ai-model"),
    "shield.ai": ("Shield AI", "robotics"), "braincorp.com": ("Brain Corp", "robotics"),
    "viam.com": ("Viam", "robotics"),
    # India SaaS / startups
    "freshworks.com": ("Freshworks", "saas"), "zoho.com": ("Zoho", "saas"),
    "zohocorp.com": ("Zoho", "saas"), "chargebee.com": ("Chargebee", "saas"),
    "browserstack.com": ("BrowserStack", "devtools"), "lambdatest.com": ("LambdaTest", "devtools"),
    "postman.com": ("Postman", "devtools"), "hackerearth.com": ("HackerEarth", "devtools"),
    "wingify.com": ("Wingify", "saas"), "whatfix.com": ("Whatfix", "saas"),
    "mindtickle.com": ("Mindtickle", "saas"), "leadsquared.com": ("LeadSquared", "saas"),
    "moengage.com": ("MoEngage", "martech"), "clevertap.com": ("CleverTap", "martech"),
    "gupshup.io": ("Gupshup", "martech"), "netomi.com": ("Netomi", "ai-app"),
    "kissflow.com": ("Kissflow", "saas"), "darwinbox.com": ("Darwinbox", "hrtech"),
    "keka.com": ("Keka", "hrtech"), "leena.ai": ("Leena AI", "hrtech"),
    "phenom.com": ("Phenom", "hrtech"), "turbohire.co": ("TurboHire", "hrtech"),
    "springworks.in": ("Springworks", "hrtech"), "hirebound.io": ("Hirebound", "hrtech"),
    "uniphore.com": ("Uniphore", "ai-app"), "observe.ai": ("Observe.AI", "ai-app"),
    "haptik.ai": ("Haptik", "ai-app"), "yellow.ai": ("Yellow.ai", "ai-app"),
    "verloop.io": ("Verloop", "ai-app"), "skit.ai": ("Skit.ai", "voice-ai"),
    "kore.ai": ("Kore.ai", "ai-app"), "exotel.com": ("Exotel", "saas"),
    "ozonetel.com": ("Ozonetel", "saas"), "gramener.com": ("Gramener", "data"),
    "fractal.ai": ("Fractal", "data"), "latentview.com": ("LatentView", "data"),
    "tredence.com": ("Tredence", "data"), "mu-sigma.com": ("Mu Sigma", "data"),
    "quantiphi.com": ("Quantiphi", "data"), "tigeranalytics.com": ("Tiger Analytics", "data"),
    "sarvam.ai": ("Sarvam AI", "ai-model"), "krutrim.com": ("Krutrim", "ai-model"),
    "olakrutrim.com": ("Ola Krutrim", "ai-model"), "qure.ai": ("Qure.ai", "healthtech"),
    "niramai.com": ("Niramai", "healthtech"), "arya.ai": ("Arya.ai", "ai-app"),
    "raga.ai": ("RagaAI", "observability"), "pixis.ai": ("Pixis", "martech"),
    "entropiktech.com": ("Entropik", "martech"), "nextbillion.ai": ("NextBillion.ai", "ai-app"),
    "corover.ai": ("CoRover", "ai-app"), "fluid.ai": ("Fluid AI", "ai-app"),
    "gtmbuddy.ai": ("GTM Buddy", "saas"), "nanonets.com": ("Nanonets", "ai-app"),
    "docsumo.com": ("Docsumo", "ai-app"), "hevodata.com": ("Hevo Data", "data"),
    "truefoundry.com": ("TrueFoundry", "ai-infra"), "neysa.ai": ("Neysa", "ai-infra"),
    "neysa.network": ("Neysa", "ai-infra"),
    # India consumer / fintech
    "razorpay.com": ("Razorpay", "fintech"), "cashfree.com": ("Cashfree", "fintech"),
    "juspay.in": ("Juspay", "fintech"), "cred.club": ("CRED", "fintech"),
    "zerodha.com": ("Zerodha", "fintech"), "groww.in": ("Groww", "fintech"),
    "phonepe.com": ("PhonePe", "fintech"), "navi.com": ("Navi", "fintech"),
    "coindcx.com": ("CoinDCX", "fintech"), "stablemoney.in": ("Stable Money", "fintech"),
    "scapia.cards": ("Scapia", "fintech"), "fibe.in": ("Fibe", "fintech"),
    "zaggle.in": ("Zaggle", "fintech"), "open.money": ("Open", "fintech"),
    "cleartax.in": ("ClearTax", "fintech"), "rupeek.com": ("Rupeek", "fintech"),
    "goniyo.com": ("Niyo", "fintech"), "simpl.com": ("Simpl", "fintech"),
    "signzy.com": ("Signzy", "fintech"), "m2pfintech.com": ("M2P Fintech", "fintech"),
    "decentro.tech": ("Decentro", "fintech"), "fampay.in": ("FamPay", "fintech"),
    "flipkart.com": ("Flipkart", "ecommerce"), "meesho.com": ("Meesho", "ecommerce"),
    "swiggy.in": ("Swiggy", "ecommerce"), "swiggy.com": ("Swiggy", "ecommerce"),
    "zomato.com": ("Zomato", "ecommerce"), "zeptonow.com": ("Zepto", "ecommerce"),
    "udaan.com": ("Udaan", "ecommerce"), "nobroker.in": ("NoBroker", "saas"),
    "rapido.bike": ("Rapido", "saas"), "olaelectric.com": ("Ola Electric", "other"),
    "atherenergy.com": ("Ather Energy", "other"), "curefit.com": ("Cult.fit", "healthtech"),
    "licious.com": ("Licious", "ecommerce"), "ultrahuman.com": ("Ultrahuman", "healthtech"),
    "lenskart.in": ("Lenskart", "ecommerce"), "lenskart.com": ("Lenskart", "ecommerce"),
    "sharechat.co": ("ShareChat", "social"), "pocketfm.com": ("Pocket FM", "social"),
    "astrotalk.com": ("Astrotalk", "social"), "glance.com": ("Glance", "social"),
    "inmobi.com": ("InMobi", "martech"), "amagi.com": ("Amagi", "saas"),
    "nykaa.com": ("Nykaa", "ecommerce"), "myntra.com": ("Myntra", "ecommerce"),
    "delhivery.com": ("Delhivery", "logistics"), "locus.sh": ("Locus", "logistics"),
    "loconav.com": ("LocoNav", "logistics"), "shipsy.io": ("Shipsy", "logistics"),
    # global SaaS / fintech / infra
    "stripe.com": ("Stripe", "fintech"), "plaid.com": ("Plaid", "fintech"),
    "adyen.com": ("Adyen", "fintech"), "retool.com": ("Retool", "devtools"),
    "zapier.com": ("Zapier", "saas"), "make.com": ("Make", "saas"),
    "monday.com": ("monday.com", "saas"), "typeform.com": ("Typeform", "saas"),
    "shopify.com": ("Shopify", "ecommerce"), "dropbox.com": ("Dropbox", "saas"),
    "atlassian.com": ("Atlassian", "devtools"), "zendesk.com": ("Zendesk", "saas"),
    "gumroad.com": ("Gumroad", "saas"), "wix.com": ("Wix", "saas"),
    "squarespace.com": ("Squarespace", "saas"), "flexport.com": ("Flexport", "logistics"),
    "auditboard.com": ("AuditBoard", "saas"), "smartcar.com": ("Smartcar", "saas"),
    "getstream.io": ("Stream", "devtools"), "nylas.com": ("Nylas", "devtools"),
    "100ms.live": ("100ms", "devtools"), "appsmith.com": ("Appsmith", "devtools"),
    "ycombinator.com": ("Y Combinator", "other"),
    # IT services
    "infosys.com": ("Infosys", "services"), "tcs.com": ("TCS", "services"),
    "wipro.com": ("Wipro", "services"), "hcltech.com": ("HCLTech", "services"),
    "techmahindra.com": ("Tech Mahindra", "services"), "ltimindtree.com": ("LTIMindtree", "services"),
    "mphasis.com": ("Mphasis", "services"), "coforge.com": ("Coforge", "services"),
    "persistent.com": ("Persistent Systems", "services"), "cognizant.com": ("Cognizant", "services"),
    "capgemini.com": ("Capgemini", "services"), "globant.com": ("Globant", "services"),
    "thoughtworks.com": ("Thoughtworks", "services"), "epam.com": ("EPAM", "services"),
    "genpact.com": ("Genpact", "services"), "happiestminds.com": ("Happiest Minds", "services"),
    "zensar.com": ("Zensar", "services"), "cyient.com": ("Cyient", "services"),
    "kpit.com": ("KPIT", "services"), "hexaware.com": ("Hexaware", "services"),
    "ust.com": ("UST", "services"), "virtusa.com": ("Virtusa", "services"),
    "synechron.com": ("Synechron", "services"), "xoriant.com": ("Xoriant", "services"),
    "nitorinfotech.com": ("Nitor Infotech", "services"), "cuelogic.com": ("Cuelogic", "services"),
    # big tech / misc
    "apple.com": ("Apple", "other"), "amazon.com": ("Amazon", "other"),
    "google.com": ("Google", "other"), "uber.com": ("Uber", "other"),
    "ebay.com": ("eBay", "ecommerce"), "linkedin.com": ("LinkedIn", "saas"),
    "adobe.com": ("Adobe", "saas"), "workday.com": ("Workday", "hrtech"),
    "qualcomm.com": ("Qualcomm", "other"), "synopsys.com": ("Synopsys", "other"),
}

# ---------------------------------------------------------------- helpers
TLD_LABELS = {"com", "io", "ai", "co", "in", "uk", "dev", "tech", "app", "net",
              "org", "run", "sh", "me", "xyz", "build", "bio", "energy", "money",
              "cards", "bike", "live", "tv", "gg", "one", "us", "ph", "eu", "so",
              "ca", "se", "at", "pl", "fi", "no", "company", "health", "design",
              "team", "editor", "network", "address", "football", "engineer",
              "cx", "ml", "pe", "edu", "ac", "with"}
PREFIXES = ("get", "try", "use", "join", "go", "the", "my", "is", "with", "we")

def registrable(domain):
    labels = domain.split(".")
    while len(labels) > 1 and labels[-1] in TLD_LABELS:
        labels.pop()
    return labels[-1] if labels else domain

def display_name(domain):
    if domain in KNOWN:
        return KNOWN[domain][0]
    core = registrable(domain)
    for p in PREFIXES:
        if core.startswith(p) and len(core) > len(p) + 2:
            core = core[len(p):]
            break
    core = core.replace("-", " ").replace("_", " ")
    return " ".join(w.capitalize() for w in core.split()) or domain

def infer_sector(domain):
    if domain in KNOWN:
        return KNOWN[domain][1]
    d = domain.lower()
    def has(*ks): return any(k in d for k in ks)
    if has("pay", "fin", "card", "money", "bank", "credit", "ledger", "invoic",
           "billing", "tax", "lend", "loan", "wallet", "capital"): return "fintech"
    if has("recruit", "hire", "hiring", "talent", "jobs", "staff", "hr"): return "hrtech"
    if has("robot", "autonom", "drone", "physical"): return "robotics"
    if has("voice", "speech", "audio", "call", "dub", "tts", "speak", "vocode"): return "voice-ai"
    if has("video", "film", "motion", "render", "reel"): return "video-ai"
    if has("image", "photo", "design", "draw", "vision", "art"): return "image-ai"
    if has("security", "secure", "auth", "identity", "fraud", "defense", "cyber"): return "security"
    if has("health", "care", "medic", "bio", "dental", "clinic", "pharma", "patient", "therap"): return "healthtech"
    if has("data", "analytic", "warehouse", "lake", "etl"): return "data"
    if has("cloud", "infra", "deploy", "server", "compute", "gpu", "host", "runtime"): return "cloud"
    if has("agent", "agentic"): return "agents"
    if has("shop", "commerce", "retail", "cart", "store", "mart"): return "ecommerce"
    if has("learn", "course", "academy", "tutor", "school", "univ", "edu", "kalam"): return "edtech"
    if has("logistic", "ship", "fleet", "supply", "freight", "cargo", "delivery"): return "logistics"
    if d.endswith(".ai"): return "ai-app"
    if d.endswith((".dev", ".sh")): return "devtools"
    if d.endswith((".io", ".tech")): return "saas"
    return "other"

INFRA_LIKE = {"ai-infra", "ai-model", "vectordb", "cloud", "data"}
DEV_LIKE = {"devtools", "observability", "security", "agents"}
APP_LIKE = {"ai-app", "voice-ai", "video-ai", "image-ai", "audio-ai", "design", "martech"}
HIGH_FIT = INFRA_LIKE | DEV_LIKE | APP_LIKE

def hook(sector, company):
    if sector in INFRA_LIKE:
        return (f"The developers wiring up {company}'s APIs basically live in that terminal — "
                f"and on spnr, the agents acting for them can bid for your slot directly over x402.")
    if sector in DEV_LIKE:
        return (f"{company} already lives where developers work; spnr extends that reach into "
                f"their agent's idle wait-time, where nothing else is competing for attention.")
    if sector in APP_LIKE:
        return (f"Your earliest adopters are builders running AI coding agents all day — "
                f"which is exactly who spnr puts {company} in front of.")
    return ("spnr reaches an audience that's otherwise hard to buy: developers actively running "
            "AI coding tools, right inside the terminal.")

INTRO = ("I'm Rohan, building spnr — an open, terminal-native ad network that monetizes the "
         "\"spinner\" wait-time in AI coding tools like Claude Code and Codex. While a developer's "
         "agent is working, the spinner shows a sponsored line plus a clickable earnings status-line.")
SIG = ("— Rohan\nspnr · the open ad network for AI-coding-agent wait-time\n"
       "github.com/rohansx/spnr")

def first_name(local):
    tok = re.split(r"[._\-+0-9]", local)[0]
    if len(tok) >= 3 and tok.isalpha():
        return tok.capitalize()
    return None

def build_copy(angle, greeting, company, sector):
    if angle == "recruiting":
        subject = f"Hiring engineers? Reach them inside Claude Code — {company}"
        body = (f"{greeting}\n\n{INTRO}\n\n"
                f"It's a way to put {company}'s open roles in front of engineers at the exact "
                f"moment they're heads-down shipping code — active developers, not job-board "
                f"browsers. Every impression is cryptographically attested, and the clickable "
                f"status-line link can point straight at your careers page.\n\n"
                f"Pricing is simple: 1 block = 1,000 impressions (5s each) from $1, clicks billed "
                f"at 50×. Honest heads-up — spnr is an early v0.1 prototype, so this is a "
                f"founding-partner pilot focused on reach and feedback.\n\n"
                f"Open to a quick 15-min call to get {company}'s roles in front of developers where "
                f"they actually spend their day?\n\n{SIG}")
        copy = (f"Get {company}'s open roles in front of engineers mid-build — attested "
                f"developer attention on spnr's terminal ad network.")
        return subject, body, copy
    # advertiser / personal
    h = hook(sector, company)
    if angle == "personal":
        subject = f"Idea for {company} — ads in the AI-coding spinner"
        body = (f"{greeting}\n\n{INTRO}\n\n{h}\n\n"
                f"We're lining up a handful of founding advertisers and {company} feels like a "
                f"natural fit. It's the only *attested, anomaly-filtered* terminal ad slot — "
                f"Ed25519-signed, hash-chained impressions — and the only one autonomous "
                f"agents can bid on via x402. Blocks start at $1 per 1,000 impressions (5s each), "
                f"open ascending auction, clicks at 50×. Fair warning: it's an early v0.1, so "
                f"this is about reach + feedback, not real payouts yet.\n\n"
                f"Worth a quick 15 minutes to see if it's interesting for {company}?\n\n{SIG}")
    else:
        if sector in INFRA_LIKE or sector in DEV_LIKE:
            subject = f"{company} × spnr — reach devs (and their agents) inside the terminal"
        else:
            subject = f"Put {company} in front of developers mid-build — spnr"
        body = (f"{greeting}\n\n{INTRO}\n\n{h}\n\n"
                f"It's the only *attested, anomaly-filtered* terminal ad slot: every impression is "
                f"Ed25519-signed and BLAKE3 hash-chained, so you pay for verified developer "
                f"attention, not self-reported counts. Pricing mirrors the category — 1 block = "
                f"1,000 impressions (5s each) from $1, open ascending auction, clicks billed at "
                f"50×. It's also the only slot autonomous agents can bid on directly via x402.\n\n"
                f"Straight up: spnr is an early v0.1 prototype and real-money settlement isn't wired "
                f"up yet — so this is a founding-advertiser pilot, about reach and shaping the "
                f"product, not a polished dashboard.\n\n"
                f"Would you be open to a 15-min call to claim {company}'s category slot before "
                f"someone else does?\n\n{SIG}")
    copy = (f"Put {company} in front of developers while their AI coding agent works — "
            f"attested, agent-biddable terminal ad slots on spnr.")
    return subject, body, copy

# ---------------------------------------------------------------- main
def load_rows():
    rows = []
    for f in sorted(glob.glob(os.path.join(DATA, "part*.tsv"))):
        with open(f, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                parts = line.split()
                if len(parts) != 4:
                    raise ValueError(f"bad line in {f}: {line!r}")
                rid, email, ocode, ccode = parts
                rows.append((int(rid), email, ocode, ccode))
    return rows

def main():
    rows = load_rows()
    records = []
    seen = {}
    stats = {"total": 0, "send": 0, "skipped": 0,
             "by_angle": {}, "by_category": {}, "by_sector": {}, "by_skip": {}, "by_origin": {}}

    for rid, email, ocode, ccode in rows:
        stats["total"] += 1
        local, _, domain = email.partition("@")
        origin = ORIGIN.get(ocode, "Global / Unknown")
        category = CATEGORY.get(ccode, "Individual")
        company = display_name(domain)
        sector = infer_sector(domain)
        fit = "low" if False else ("high" if sector in HIGH_FIT else "medium")

        # send / skip
        skip = classify_junk(email, local, domain)
        if not skip and email in seen:
            skip = f"duplicate of #{seen[email]}"
        send = skip is None
        if email not in seen:
            seen[email] = rid

        # angle
        if not send:
            angle = "skip"
        elif category == "HR / Talent":
            angle = "recruiting"
        elif category in ("Leadership", "General"):
            angle = "advertiser"
        else:  # Individual
            if is_recruit(local):
                angle = "recruiting"
            elif local.lower() in EXEC_BIZ:
                angle = "advertiser"
            else:
                angle = "personal"

        # greeting
        greeting = None
        fn = None
        if send:
            if angle == "personal":
                fn = first_name(local)
                if fn:
                    greeting = f"Hi {fn},"
                else:
                    angle = "advertiser"
                    greeting = f"Hi {company} team,"
            else:
                greeting = f"Hi {company} team,"

        # copy
        if send:
            subject, body, copy = build_copy(angle, greeting, company, sector)
        else:
            subject = body = None
            copy = skip

        rec = {
            "id": rid, "email": email, "local_part": local, "domain": domain,
            "company": company, "sector": sector, "category": category,
            "origin": origin, "fit": (fit if send else "skip"),
            "angle": angle, "send": send, "skip_reason": skip,
            "first_name": fn, "greeting": greeting,
            "subject": subject, "body": body, "copy": copy,
        }
        records.append(rec)

        # stats
        stats["by_category"][category] = stats["by_category"].get(category, 0) + 1
        stats["by_origin"][origin] = stats["by_origin"].get(origin, 0) + 1
        if send:
            stats["send"] += 1
            stats["by_angle"][angle] = stats["by_angle"].get(angle, 0) + 1
            stats["by_sector"][sector] = stats["by_sector"].get(sector, 0) + 1
        else:
            stats["skipped"] += 1
            key = skip.split(" — ")[0].split(" of ")[0]
            stats["by_skip"][key] = stats["by_skip"].get(key, 0) + 1

    out = {
        "meta": {
            "product": "spnr",
            "one_liner": ("Open, terminal-native ad network that monetizes the AI-coding-agent "
                          "\"spinner\" wait-time (Claude Code / Codex). Attested, anomaly-filtered "
                          "impressions; the only ad slot autonomous agents can bid on via x402."),
            "outreach_goal": ("Recruit founding ADVERTISERS for spnr: companies that want to reach "
                              "developers (and their agents) actively running AI coding tools."),
            "the_ask": ("A 15-minute call to run a founding-advertiser pilot block "
                        "(1,000 impressions of 5s each, from $1; clicks billed 50x)."),
            "angles": {
                "advertiser": "Leadership/General/exec-alias -> advertise your product to devs on spnr.",
                "recruiting": "HR/Talent + careers/jobs/hiring aliases -> advertise open roles to devs mid-build.",
                "personal": "Named individuals -> first-name note, advertiser framing.",
            },
            "honesty_note": ("spnr is a v0.1 research prototype; real-money settlement is not yet "
                             "implemented. Copy frames every pitch as an early founding-advertiser "
                             "pilot, never as a live payments product."),
            "personalization": "Curated company knowledge base + sector inference (no live web).",
            "sender": "rohansx",
        },
        "stats": stats,
        "records": records,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)

    print(f"wrote {OUT}")
    print(json.dumps(stats, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()

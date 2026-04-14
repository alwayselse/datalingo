"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { useAuthStore } from "@/store/auth";
import type { Source } from "@/types";

type ToolKey = "forge" | "formula" | "case" | "exam" | "brief";

type MessageRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  sources?: Source[];
  isComplete?: boolean;
}

interface UploadedDoc {
  filename: string;
  doc_id?: string;
  collection_id?: string;
  summary?: string;
  gemini_file_name?: string;
}

interface ToolSignalData {
  formula?: string;
  company?: string;
  [key: string]: unknown;
}

interface SlashCommand {
  cmd: string;
  description: string;
  action: "send" | "tool" | "route";
  tool?: ToolKey;
}

interface ForgeResult {
  score: number;
  overall: string;
  what_you_got_right: string[];
  what_to_strengthen: string[];
  corrected_explanation: string;
  error?: string;
}

interface ExamQuestionData {
  question: string;
  type?: string;
  difficulty?: string;
  hints?: string[];
  rubric?: Array<{ criterion: string; points: number }>;
  total_points?: number;
}

interface ExamResultData {
  score: number;
  grade: string;
  overall_feedback: string;
  rubric_breakdown: Array<{
    criterion: string;
    achieved: boolean;
    feedback: string;
  }>;
  model_answer_hints: string[];
  encourage: string;
}

interface BriefData {
  topic: string;
  read_time_minutes: number;
  what_you_know: string[];
  whats_coming: Array<{ concept: string; why_it_matters: string }>;
  watch_out_for: Array<{ misconception: string; reality: string }>;
  key_formula?: {
    name?: string | null;
    expression?: string;
    plain_english?: string;
  };
  warm_up_question?: string;
}

type CaseTechniqueComplexity = "basic" | "intermediate" | "advanced";

interface CaseStudy {
  id: string;
  company: string;
  industry: string;
  country: string;
  year: string;
  ba_topics?: string[];
  logo_letter: string;
  unit_color: string;
  tagline: string;
  hero_metric: {
    value: string;
    label: string;
    context: string;
  };
  the_problem: string;
  data_used: Array<{
    type: string;
    volume: string;
    insight: string;
  }>;
  ba_techniques: Array<{
    name: string;
    description: string;
    complexity: CaseTechniqueComplexity;
  }>;
  the_solution: string;
  outcome: Array<{
    metric: string;
    result: string;
    timeframe: string;
  }>;
  key_lesson: string;
  discussion_starters: string[];
}

interface CaseChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  isComplete?: boolean;
}

interface RecentSession {
  id: string;
  title: string;
  created_at?: string;
  updated_at?: string;
}

function materialIconStyle(size: number, color?: string) {
  return {
    fontFamily: "Material Symbols Outlined",
    fontSize: `${size}px`,
    fontStyle: "normal",
    fontWeight: "normal",
    lineHeight: 1,
    letterSpacing: "normal",
    textTransform: "none" as const,
    display: "inline-block",
    whiteSpace: "nowrap" as const,
    WebkitFontFeatureSettings: '"liga"',
    WebkitFontSmoothing: "antialiased" as const,
    color,
  };
}

function Icon({ name, size = 20, color }: { name: string; size?: number; color?: string }) {
  return <span className="material-symbols-outlined" style={materialIconStyle(size, color)}>{name}</span>;
}

const TOOL_LABELS: Record<ToolKey, string> = {
  forge: "Concept Forge",
  formula: "Formula Lab",
  case: "Case Study",
  exam: "Exam Simulator",
  brief: "Pre-class Brief",
};

const BA_TOPICS = [
  "Business Analytics Frameworks & Decision-Making",
  "Customer Data & Analytics Lifecycle",
  "Data Extraction & Analytics",
  "Data Visualization & Dashboards",
  "RFM Analysis",
  "Customer Segmentation & CLV",
  "Causality in Business Analytics",
  "Experimental Design & RCTs",
  "A/B Testing & Hypothesis Testing",
  "Pricing Analytics & Revenue Mgmt",
  "Price Elasticity & Demand Sensitivity",
  "Promotion & Offer Optimization",
  "Time Series Data & Business Applications",
  "Trend, Seasonality & Cycles",
  "Forecasting Methods (MA, ES, ARIMA)",
  "Customer Retention & Churn Analytics",
  "Inventory Control & Demand Planning",
  "Supply Chain Analytics & KPIs",
  "Text & Sentiment Analysis",
  "Advanced Experimentation & Multivariate Testing",
  "Ethics, Bias & Responsible Analytics",
  "Data Privacy & Governance",
  "Capstone Project",
];

const CUSTOM_FORGE_TOPIC_VALUE = "__custom_topic__";

const CASE_STUDIES: CaseStudy[] = [
  {
    id: "netflix",
    company: "Netflix",
    industry: "Streaming & Entertainment",
    country: "USA",
    year: "2022",
    logo_letter: "N",
    unit_color: "#dc2626",
    tagline: "How data killed the video store",
    hero_metric: {
      value: "$1B+",
      label: "Saved annually",
      context: "through recommendation engine reducing churn",
    },
    the_problem: `In 2006, Netflix was mailing DVDs and losing
customers who couldn't find movies they wanted to watch.
With 100,000+ titles and no way to surface the right one,
subscribers cancelled rather than browse. The problem
wasn't content — it was discovery. Netflix needed to
predict what each of 200 million users would enjoy
before they even searched for it.`,
    data_used: [
      {
        type: "Viewing history",
        volume: "250M+ hours watched daily",
        insight: "Completion rate revealed true satisfaction better than ratings",
      },
      {
        type: "Engagement signals",
        volume: "30M daily \"plays\", pause, rewind events",
        insight: "Re-watches predicted superfan segments worth targeting",
      },
      {
        type: "Time & device data",
        volume: "4M search queries daily",
        insight: "Friday night mobile viewing had different taste profiles than weekend TV",
      },
    ],
    ba_techniques: [
      {
        name: "Collaborative Filtering",
        description: "Found users with similar taste profiles and surfaced what they loved",
        complexity: "advanced",
      },
      {
        name: "RFM-style Engagement Scoring",
        description: "Scored users by recency of watch, frequency of sessions, and depth of engagement",
        complexity: "intermediate",
      },
      {
        name: "A/B Testing at Scale",
        description: "Tested 1000s of thumbnail variants per title to maximise click-through",
        complexity: "intermediate",
      },
      {
        name: "Churn Prediction Modelling",
        description: "Identified subscribers showing disengagement signals 30 days before cancellation",
        complexity: "advanced",
      },
    ],
    the_solution: `Netflix built a two-tower recommendation
system that combined content-based filtering
(what the show is) with collaborative filtering
(what similar users watched). They personalized
not just recommendations but thumbnail artwork —
a thriller fan saw action screenshots while a
romance fan saw the same movie with different
imagery. Every subscriber sees a different
homepage.`,
    outcome: [
      { metric: "Churn reduction", result: "~25% lower monthly churn", timeframe: "Post-2012 rollout" },
      { metric: "Content savings", result: "$1B+ annually", timeframe: "Ongoing" },
      { metric: "Recommendation adoption", result: "80% of watched content", timeframe: "Comes from recommendations" },
    ],
    key_lesson: `Retention is cheaper than acquisition.
Netflix proved that showing one perfectly matched
title prevents a cancellation better than
any discount.`,
    discussion_starters: [
      "Netflix uses completion rate instead of star ratings. Why might a 90% completion rate be more valuable signal than a 5-star review?",
      "Their recommendation engine saves $1B but also creates \"filter bubbles\". Is that an acceptable tradeoff for a subscription business?",
      "How would you adapt Netflix's RFM scoring to a grocery delivery app? What would Recency, Frequency, and Monetary mean in that context?",
      "Netflix personalizes thumbnails per user. What are the ethical implications of showing different people different versions of the same product?",
    ],
    ba_topics: ["rfm_analysis", "churn_analytics", "ab_testing", "customer_seg_clv"],
  },
  {
    id: "amazon",
    company: "Amazon",
    industry: "E-commerce & Cloud",
    country: "USA",
    year: "2023",
    logo_letter: "A",
    unit_color: "#d97706",
    tagline: "Shipping you ordered before you knew you wanted it",
    hero_metric: {
      value: "35%",
      label: "Of revenue",
      context: "directly attributed to recommendation engine",
    },
    the_problem: `Amazon warehouses 350 million products across
175 fulfillment centers. The core logistics problem:
getting any product to any customer in 24 hours
costs a fortune if you move it after the order.
Amazon's insight — what if you moved inventory
to the right city before customers ordered?
To do that, you need to predict demand by
location with terrifying accuracy.`,
    data_used: [
      {
        type: "Purchase & browse history",
        volume: "300M+ active customer profiles",
        insight: "Browse-to-buy gap revealed purchase intent timing",
      },
      {
        type: "Supply chain & inventory data",
        volume: "350M SKUs tracked in real time",
        insight: "Stockout prediction 2 weeks ahead prevented $2B in lost sales",
      },
      {
        type: "External signals",
        volume: "Weather, events, social trends",
        insight: "A storm forecast in Texas predicts torch and battery sales 48h out",
      },
    ],
    ba_techniques: [
      {
        name: "Anticipatory Shipping (Predictive Logistics)",
        description: "Moved inventory to regional hubs before orders arrived based on demand forecasts",
        complexity: "advanced",
      },
      {
        name: "Dynamic Pricing",
        description: "Changed prices 2.5M times per day based on demand, competition, and inventory levels",
        complexity: "advanced",
      },
      {
        name: "Inventory Optimisation (EOQ variants)",
        description: "Calculated optimal reorder points per SKU per warehouse using demand variability",
        complexity: "intermediate",
      },
      {
        name: "Customer Segmentation",
        description: "Separated Prime vs non-Prime behavior to personalise promotions and pricing floors",
        complexity: "basic",
      },
    ],
    the_solution: `Amazon built a predictive logistics system
that pre-positions inventory based on regional
demand forecasts. Combined with dynamic pricing
that responds to competitor prices every
10 minutes, they created a flywheel:
lower prices → more orders → more data →
better forecasts → lower costs → lower prices.`,
    outcome: [
      { metric: "Delivery speed", result: "Same-day in 90+ cities", timeframe: "2023" },
      { metric: "Inventory waste", result: "30% reduction in overstock", timeframe: "Vs 2015 baseline" },
      { metric: "Revenue from recommendations", result: "35% of total", timeframe: "Annual" },
    ],
    key_lesson: `Demand forecasting is most powerful when
it drives physical action — moving inventory,
not just adjusting a webpage. The further
upstream analytics reaches, the bigger the impact.`,
    discussion_starters: [
      "Amazon changes prices 2.5M times per day. Calculate: if average order value is $45 and they have 5M daily orders, what revenue impact does even a 0.5% pricing optimisation create?",
      "Their anticipatory shipping system moves goods before orders exist. What happens when the forecast is wrong? How should they account for forecast error in inventory decisions?",
      "Small retailers cannot afford Amazon's data infrastructure. What is the minimum viable version of demand forecasting a 10-person e-commerce business could implement?",
      "Amazon uses your browse history even when you don't buy. Is there a point where personalisation becomes surveillance? Where would you draw the line as a BA practitioner?",
    ],
    ba_topics: ["inventory_control", "supply_chain_kpis", "forecasting_methods", "pricing_analytics", "customer_seg_clv"],
  },
  {
    id: "zomato",
    company: "Zomato",
    industry: "Food Delivery & Tech",
    country: "India",
    year: "2023",
    logo_letter: "Z",
    unit_color: "#dc2626",
    tagline: "Feeding 500 cities with 10-minute promises",
    hero_metric: {
      value: "10 min",
      label: "Delivery target",
      context: "Zomato Instant — requires sub-2min prep prediction",
    },
    the_problem: `Zomato operates in 500+ Indian cities where
addresses don't have standardised postal codes,
traffic is unpredictable, and 60% of orders
come in a 2-hour dinner window. Promising
delivery times they can't keep destroys
trust. Getting it right requires predicting
restaurant prep time, rider availability,
and traffic — simultaneously — for
millions of orders per day.`,
    data_used: [
      {
        type: "Order & restaurant data",
        volume: "500M+ orders analyzed",
        insight: "Restaurant prep time varied 3x between weekday lunch and Friday dinner",
      },
      {
        type: "Rider GPS & movement",
        volume: "300,000+ delivery partners tracked",
        insight: "Idle rider clustering by zone predicted pickup time within 90 seconds",
      },
      {
        type: "Hyperlocal demand signals",
        volume: "City × cuisine × time of day matrices",
        insight: "Biryani demand in Hyderabad on Friday night was 12x Tuesday lunch",
      },
    ],
    ba_techniques: [
      {
        name: "Time Series Demand Forecasting",
        description: "Predicted order volumes per zone per hour to pre-position riders before demand spikes",
        complexity: "intermediate",
      },
      {
        name: "Dynamic Surge Pricing",
        description: "Raised delivery fees during peak demand to balance supply and reduce wait times",
        complexity: "intermediate",
      },
      {
        name: "Churn & Loyalty Analytics",
        description: "Identified users who ordered once and never returned — triggered win-back campaigns",
        complexity: "intermediate",
      },
      {
        name: "Supply Chain Optimisation",
        description: "Zomato Hyperpure used demand data to help restaurants order ingredients 48h ahead",
        complexity: "advanced",
      },
    ],
    the_solution: `Zomato built a real-time demand prediction
engine that pre-positions delivery riders
in zones 20-30 minutes before demand arrives.
Their ML model predicts restaurant prep time
per dish, combines it with live traffic and
rider location data to give an accurate
delivery ETA before the customer even
confirms the order.`,
    outcome: [
      { metric: "ETA accuracy", result: "92%+ on-time delivery", timeframe: "2023" },
      { metric: "Rider efficiency", result: "40% more deliveries per rider per hour", timeframe: "Post-ML routing" },
      { metric: "Customer retention", result: "3x higher repeat order rate", timeframe: "For users with accurate first ETA" },
    ],
    key_lesson: `In hyperlocal businesses, time series
forecasting at the micro-zone level
(not city level) is what separates
accurate ETAs from broken promises.
Granularity of data determines
quality of prediction.`,
    discussion_starters: [
      "Zomato pre-positions riders before orders arrive. What data would you need to build this model, and what would be your key forecast variable?",
      "Their surge pricing raises fees when demand peaks. Use the PED formula: if a 20% fee increase causes 8% order drop, what is the price elasticity? Is this elastic or inelastic?",
      "Zomato has different data quality in Mumbai vs a Tier-3 city. How should a BA team adjust their models when historical data is sparse?",
      "Gig workers bear the cost of demand unpredictability through income volatility. Should Zomato's analytics team consider rider income stability as a KPI alongside delivery speed?",
    ],
    ba_topics: ["time_series_ba", "trend_seasonality", "churn_analytics", "supply_chain_kpis", "price_elasticity"],
  },
  {
    id: "walmart",
    company: "Walmart",
    industry: "Retail & Supply Chain",
    country: "USA",
    year: "2023",
    logo_letter: "W",
    unit_color: "#2563eb",
    tagline: "How a hurricane warning sells strawberry Pop-Tarts",
    hero_metric: {
      value: "$2.1B",
      label: "Saved annually",
      context: "through predictive inventory and waste reduction",
    },
    the_problem: `Walmart serves 230 million customers weekly
across 10,500 stores. The inventory challenge:
overstock wastes $300B+ industry-wide annually,
while stockouts cost 4% of revenue. Every store
has different demand patterns — a store near a
stadium needs beer before game day, a store in
a hurricane zone needs different goods
than one in a mild climate. One-size
supply chain kills margin.`,
    data_used: [
      {
        type: "POS transaction data",
        volume: "2.5 petabytes generated daily",
        insight: "Strawberry Pop-Tart sales increase 7x before a hurricane — not obvious until you analyze it",
      },
      {
        type: "External event data",
        volume: "Weather, local events, school calendars",
        insight: "Back-to-school timing varied by 3 weeks across US regions",
      },
      {
        type: "Supplier & logistics data",
        volume: "100,000+ suppliers connected",
        insight: "Lead time variability by supplier predicted stockout risk 3 weeks ahead",
      },
    ],
    ba_techniques: [
      {
        name: "Predictive Demand Forecasting",
        description: "Used weather + event + historical data to predict demand per SKU per store 2 weeks ahead",
        complexity: "advanced",
      },
      {
        name: "EOQ and Safety Stock Optimisation",
        description: "Calculated optimal order quantities per store factoring in demand variability and supplier lead time",
        complexity: "intermediate",
      },
      {
        name: "Supplier Performance Analytics",
        description: "Scored suppliers on OTIF (On Time In Full) and used scores to adjust safety stock levels",
        complexity: "intermediate",
      },
      {
        name: "Promotional Lift Modelling",
        description: "Quantified true uplift from promotions vs baseline demand to avoid over-ordering",
        complexity: "advanced",
      },
    ],
    the_solution: `Walmart built a Retail Link system connecting
100,000 suppliers to real-time store-level
sales data. Suppliers can see their products
selling in real time and adjust shipments
proactively. Combined with ML demand
forecasting that ingests weather, events,
and local calendars, stores receive
the right inventory before they need it.`,
    outcome: [
      { metric: "Inventory waste", result: "15% reduction in food waste", timeframe: "2023" },
      { metric: "Stockout rate", result: "From 8% to under 3%", timeframe: "2018-2023" },
      { metric: "Supplier efficiency", result: "98.5% OTIF rate for top-tier suppliers", timeframe: "2023" },
    ],
    key_lesson: `External data (weather, events, local context)
often explains demand spikes that pure
historical analysis misses entirely.
The Pop-Tart insight only emerged by
joining sales data with hurricane records.`,
    discussion_starters: [
      "Walmart found Pop-Tart sales spike 7x before hurricanes. Walk through how you would discover this insight — what data join, what analysis, what would you look for?",
      "Calculate EOQ for a Walmart store: annual demand 50,000 units, ordering cost $200 per order, holding cost $4 per unit per year. What is the optimal order quantity?",
      "Walmart shares real-time sales data with 100,000 suppliers. What are the competitive risks of this level of data transparency, and how would you manage them?",
      "Their OTIF scoring system penalises late suppliers. A small local supplier in a rural area has worse logistics than a national one — is OTIF a fair metric for all supplier sizes?",
    ],
    ba_topics: ["inventory_control", "supply_chain_kpis", "forecasting_methods", "promo_optimization", "experimental_design"],
  },
  {
    id: "airbnb",
    company: "Airbnb",
    industry: "Travel & Marketplace",
    country: "USA",
    year: "2023",
    logo_letter: "Ab",
    unit_color: "#ec4899",
    tagline: "Pricing 7 million listings in real time",
    hero_metric: {
      value: "40%",
      label: "Revenue increase",
      context: "for hosts using Smart Pricing vs manual pricing",
    },
    the_problem: `Airbnb hosts are regular people, not revenue
managers. Most price their listing once and
forget it — which means they're too expensive
during slow seasons and too cheap during
festivals. A host in Bangalore during IPL
season could charge 3x their normal rate.
A host in Goa in monsoon should drop 60%.
Without dynamic pricing, hosts leave
massive money on the table and Airbnb
earns less commission.`,
    data_used: [
      {
        type: "Booking & search data",
        volume: "7M+ listings, 150M+ users",
        insight: "Search-to-book ratio per listing revealed optimal price ceiling",
      },
      {
        type: "Local event & seasonal data",
        volume: "500,000+ events tracked globally",
        insight: "Concert announcements caused 200-400% price elasticity in nearby listings",
      },
      {
        type: "Competitive listing data",
        volume: "Neighbouring listings repriced 24M times daily",
        insight: "Price positioning relative to comparable listings drove occupancy more than absolute price",
      },
    ],
    ba_techniques: [
      {
        name: "Dynamic Pricing (Smart Pricing)",
        description: "Automatically adjusted nightly rates based on demand signals, local events, and competitor pricing",
        complexity: "advanced",
      },
      {
        name: "Price Elasticity Measurement",
        description: "Calculated PED per listing category and market to find optimal price-occupancy tradeoffs",
        complexity: "intermediate",
      },
      {
        name: "Trust & Safety Scoring",
        description: "Used review text sentiment analysis and behavior patterns to predict host/guest reliability",
        complexity: "advanced",
      },
      {
        name: "CLV Modelling for Hosts",
        description: "Predicted long-term host value to prioritize onboarding support for high-potential properties",
        complexity: "intermediate",
      },
    ],
    the_solution: `Airbnb's Smart Pricing engine analyzes
hundreds of signals per listing per night:
local events, historical demand curves,
competitor pricing, days until check-in,
and seasonal patterns. It suggests
prices that maximize revenue while
maintaining occupancy targets —
and learns from each booking outcome.`,
    outcome: [
      { metric: "Host revenue", result: "40% higher for Smart Pricing users", timeframe: "vs manual pricing" },
      { metric: "Occupancy", result: "20% higher average occupancy rate", timeframe: "2023" },
      { metric: "Platform GMV", result: "$63B in 2023", timeframe: "Up from $46B in 2021" },
    ],
    key_lesson: `Dynamic pricing works only when customers
perceive the value as fair. Airbnb balances
revenue optimisation with transparent
price explanations — showing guests
WHY a price is high prevents abandonment
that purely algorithmic pricing causes.`,
    discussion_starters: [
      "A host's listing gets 20 views but 0 bookings at $120/night. At $90/night it gets 3 bookings. Calculate the price elasticity of demand. What should the host charge?",
      "Airbnb's algorithm raises prices during disasters (evacuees fleeing floods need housing). Should a pricing algorithm have ethical overrides? Who decides what those are?",
      "Design a CLV model for Airbnb hosts. What variables would predict whether a new host will still be active in 2 years, and why does Airbnb care about that number?",
      "Smart Pricing gave hosts 40% more revenue. Why would any host NOT use it? What behavioural or psychological reasons might explain resistance to algorithmic pricing?",
    ],
    ba_topics: ["price_elasticity", "pricing_analytics", "customer_seg_clv", "text_sentiment", "ab_testing"],
  },
  {
    id: "spotify",
    company: "Spotify",
    industry: "Music Streaming",
    country: "Sweden",
    year: "2023",
    logo_letter: "S",
    unit_color: "#059669",
    tagline: "The algorithm that knows you better than your friends",
    hero_metric: {
      value: "626M",
      label: "Monthly users",
      context: "driven primarily by personalisation, not marketing spend",
    },
    the_problem: `Spotify has 100 million songs. The average
user actively knows maybe 200. The discovery
problem: how do you surface song 201 — one
they'll love but have never heard — from
a catalogue 500,000x larger than their
awareness? Get it wrong and they skip.
Too many skips and they churn.
Spotify's business model lives or
dies on discovery quality.`,
    data_used: [
      {
        type: "Listening behaviour",
        volume: "30M+ songs streamed per hour",
        insight: "Skip within 30 seconds was a stronger dislike signal than explicit thumbs down",
      },
      {
        type: "Audio feature data",
        volume: "100M+ tracks analyzed acoustically",
        insight: "Tempo, key, energy, danceability created a 13-dimension taste fingerprint per user",
      },
      {
        type: "Contextual data",
        volume: "Time, device, location, playlist name",
        insight: "\"Workout\" playlist listeners tolerated higher BPM and lower lyric complexity",
      },
    ],
    ba_techniques: [
      {
        name: "Natural Language Processing on Playlists",
        description: "Analyzed billions of playlist names and blog text to understand how songs cluster culturally",
        complexity: "advanced",
      },
      {
        name: "Cohort-based Churn Analysis",
        description: "Identified listening drop-off patterns that predicted free-to-paid conversion failure",
        complexity: "intermediate",
      },
      {
        name: "A/B Testing at Massive Scale",
        description: "Tested Discover Weekly algorithm variants on 140M users simultaneously",
        complexity: "advanced",
      },
      {
        name: "RFM Engagement Scoring",
        description: "Scored users by listening recency, frequency, and depth to identify at-risk subscribers",
        complexity: "basic",
      },
    ],
    the_solution: `Spotify's Discover Weekly combines three
approaches: collaborative filtering
(users who like X also like Y),
audio analysis (acoustically similar
tracks), and NLP on cultural context
(what music writers say about artists).
The result — 30-song weekly playlist
personalized per user — drove more
engagement than any other feature
in Spotify's history.`,
    outcome: [
      { metric: "Discover Weekly streams", result: "5B+ streams in first year", timeframe: "2016 launch" },
      { metric: "User retention", result: "40% higher for users who engage with recommendations", timeframe: "Ongoing" },
      { metric: "Artist discovery", result: "75% of Discover Weekly streams are new-to-user artists", timeframe: "2023" },
    ],
    key_lesson: `Implicit signals (skip rate, replay,
playlist adds) are far more honest
than explicit ones (ratings, likes).
Design your data collection around
what users DO, not what they SAY.`,
    discussion_starters: [
      "Spotify uses \"skip within 30 seconds\" as a dislike signal. Why might this be more reliable than a thumbs-down button? What other implicit signals would you mine from a music app?",
      "Their RFM model for music engagement — what would Recency, Frequency, and Monetary map to in a subscription streaming context where there's no direct transaction per song?",
      "Discover Weekly creates filter bubbles in music taste. Is algorithmic personalisation making culture more fragmented? Does a BA practitioner have responsibility for that outcome?",
      "If Spotify's churn model identifies a user is likely to cancel, what interventions would you test using A/B testing? Design the experiment with hypothesis, variant, and success metric.",
    ],
    ba_topics: ["rfm_analysis", "churn_analytics", "text_sentiment", "ab_testing", "customer_seg_clv"],
  },
  {
    id: "uber",
    company: "Uber",
    industry: "Ride-hailing & Logistics",
    country: "USA",
    year: "2023",
    logo_letter: "U",
    unit_color: "#1a1a24",
    tagline: "Surge pricing: hated by users, loved by economists",
    hero_metric: {
      value: "19M",
      label: "Trips per day",
      context: "balanced across supply and demand using real-time analytics",
    },
    the_problem: `On New Year's Eve, demand for rides in
Mumbai increases 800% in 20 minutes.
Uber has a fixed number of drivers.
Without intervention, all riders
get the app — none get a car.
The marketplace collapses. Uber's
challenge: use pricing and incentives
to balance supply and demand
in real time across 70 countries
simultaneously, with no central
inventory and no employed workforce.`,
    data_used: [
      {
        type: "Real-time ride requests",
        volume: "19M trips daily, GPS updated every 4 seconds",
        insight: "Demand hotspots moved predictably — bars close at 2am, offices at 6pm",
      },
      {
        type: "Driver supply data",
        volume: "5M+ drivers globally tracked in real time",
        insight: "Driver log-on rates responded to surge multipliers within 8 minutes",
      },
      {
        type: "Historical demand patterns",
        volume: "10 years of city-level data",
        insight: "Weather + event + time-of-day explained 78% of demand variance",
      },
    ],
    ba_techniques: [
      {
        name: "Dynamic Surge Pricing",
        description: "Raised prices in high-demand zones to attract drivers and reduce demand until supply matched",
        complexity: "intermediate",
      },
      {
        name: "Geospatial Demand Forecasting",
        description: "Predicted demand per hexagonal zone 15-30 minutes ahead to pre-position driver incentives",
        complexity: "advanced",
      },
      {
        name: "Driver Incentive Optimisation",
        description: "Used experimentation to find minimum bonus required to bring drivers to undersupplied zones",
        complexity: "advanced",
      },
      {
        name: "Fraud Detection Analytics",
        description: "Identified fake trip patterns and rating manipulation using behavioral anomaly detection",
        complexity: "advanced",
      },
    ],
    the_solution: `Uber built a real-time two-sided marketplace
balancing engine. On the demand side:
surge pricing signals scarcity and
reduces frivolous requests. On the
supply side: driver incentives and
forward-looking heat maps pull
drivers toward future demand.
The result is a system that
self-balances in under 10 minutes
in most markets.`,
    outcome: [
      { metric: "Wait time", result: "Average 4 minutes globally", timeframe: "2023" },
      { metric: "Surge frequency", result: "40% reduction in surge events", timeframe: "After predictive positioning" },
      { metric: "Driver earnings", result: "25% higher for drivers using heat map guidance", timeframe: "2023" },
    ],
    key_lesson: `Two-sided marketplaces require analytics
on BOTH sides simultaneously. Optimising
only for riders destroys driver supply.
Optimising only for drivers destroys
rider experience. The analytics challenge
is finding the equilibrium.`,
    discussion_starters: [
      "During NYE, Uber's surge is 4x. If base fare is ₹150 and demand elasticity is -0.6, what % drop in ride requests should Uber expect? Is this a good outcome for the platform?",
      "Uber uses a minimum experiment unit of one city for A/B tests. Why can't they randomize at the individual rider level, and what statistical problem does city-level testing create?",
      "Their driver incentive model finds the minimum bonus needed to attract supply. Is this ethically different from simply paying drivers a fair wage? Defend your position with data.",
      "Design a churn model for Uber drivers. What signals would predict a driver is about to stop driving, and what intervention would you test to retain them?",
    ],
    ba_topics: ["price_elasticity", "pricing_analytics", "experimental_design", "ab_testing", "time_series_ba"],
  },
  {
    id: "starbucks",
    company: "Starbucks",
    industry: "Food & Beverage Retail",
    country: "USA",
    year: "2023",
    logo_letter: "Sb",
    unit_color: "#059669",
    tagline: "A loyalty program with 31 million members and zero punch cards",
    hero_metric: {
      value: "57%",
      label: "Of US revenue",
      context: "from Starbucks Rewards members",
    },
    the_problem: `Coffee is a commodity. Any café can
make a latte. Starbucks' challenge:
turn a $5 transaction into a
relationship worth $1,400 over
a customer's lifetime. With 36,000
stores and 8 million daily US visits,
they had an ocean of data but needed
to use it to personalize at scale —
making 31 million members feel
individually known without
a human remembering their order.`,
    data_used: [
      {
        type: "Transaction & loyalty data",
        volume: "90M+ weekly interactions via app",
        insight: "Order time variance predicted life event changes (job change, relocation, pregnancy)",
      },
      {
        type: "Location & store data",
        volume: "36,000 stores with granular foot traffic",
        insight: "Drive-through vs walk-in behavior predicted mobile order adoption 6 months early",
      },
      {
        type: "Weather & seasonal data",
        volume: "Hourly weather per store location",
        insight: "Cold snap in October triggered Pumpkin Spice demand 2 weeks before planned launch",
      },
    ],
    ba_techniques: [
      {
        name: "Personalised Offer Engine (CLV-driven)",
        description: "Sent different offers to each of 31M members based on predicted lifetime value and order history",
        complexity: "advanced",
      },
      {
        name: "Cohort-based RFM Analysis",
        description: "Segmented customers by recency of visit, order frequency, and spend level for targeted re-engagement",
        complexity: "intermediate",
      },
      {
        name: "Market Basket Analysis",
        description: "Found which drink + food combinations predicted highest spend and designed bundle promotions",
        complexity: "intermediate",
      },
      {
        name: "Site Selection Analytics",
        description: "Used foot traffic, demographics, and competitor data to predict revenue for potential new stores",
        complexity: "advanced",
      },
    ],
    the_solution: `Starbucks built a personalization engine
called Deep Brew that powers offers,
menu recommendations, and even music
in stores. When you open the app,
the offers shown are unique to you —
based on your order history, weather,
time of day, and predicted next visit.
A lapsed customer sees a comeback offer.
A high-CLV customer sees an upsell.
A new member sees a discovery offer.`,
    outcome: [
      { metric: "Loyalty revenue share", result: "57% of US revenue", timeframe: "2023" },
      { metric: "Personalized offer redemption", result: "3x higher vs generic offers", timeframe: "Internal benchmark" },
      { metric: "App active users", result: "31.4M active Rewards members", timeframe: "Q4 2023" },
    ],
    key_lesson: `The most powerful loyalty programs
don't reward frequency — they
reward identity. Starbucks members
return not for the points but
because the app makes them feel
individually understood.
Analytics enables that feeling at scale.`,
    discussion_starters: [
      "Starbucks detects life events (new job, relocation) from order time changes. Design the analysis: what change in ordering pattern would signal a customer changed jobs? What would you do with that insight?",
      "Their RFM model has 31M members. A \"hibernating\" segment visits once per quarter. Calculate: if you convert 5% of 8M hibernators to monthly visitors at $7 average, what is the annual revenue impact?",
      "Deep Brew shows different menu items to different customers. Is it ethical to show a customer who always buys cheap items a premium upsell? Where is the line between personalization and manipulation?",
      "Site selection analytics uses competitor data to choose new store locations. If Starbucks opens near an independent café and uses data to outcompete them, is that a responsible use of analytics?",
    ],
    ba_topics: ["rfm_analysis", "customer_seg_clv", "promo_optimization", "customer_data", "churn_analytics"],
  },
  {
    id: "flipkart",
    company: "Flipkart",
    industry: "E-commerce",
    country: "India",
    year: "2023",
    logo_letter: "F",
    unit_color: "#2563eb",
    tagline: "Big Billion Days: ₹50,000 crore in 5 days",
    hero_metric: {
      value: "11x",
      label: "Traffic spike",
      context: "during Big Billion Days — predicted and prepared for weeks ahead",
    },
    the_problem: `Flipkart's Big Billion Days sale
generates more orders in 5 days
than most months combined.
In 2022, a traffic spike crashed
their website in the first hour
of the sale — costing crores
in lost revenue and trust.
The challenge: predict demand
per category per pincode,
pre-position inventory across
21 warehouses, and scale server
infrastructure — all before
the sale starts.`,
    data_used: [
      {
        type: "Wishlist & cart abandonment data",
        volume: "500M+ wishlist adds pre-sale",
        insight: "Wishlist adds 72h before sale predicted category demand with 85% accuracy",
      },
      {
        type: "Search trend data",
        volume: "Internal search + Google Trends",
        insight: "Search velocity for specific products 2 weeks pre-sale predicted sell-out risk",
      },
      {
        type: "Logistics & pincode data",
        volume: "19,000+ pincodes served",
        insight: "Tier-2 city demand grew 60% YoY — required different inventory mix than metros",
      },
    ],
    ba_techniques: [
      {
        name: "Demand Sensing (Pre-sale Signals)",
        description: "Used wishlist, search, and cart data to forecast sale demand before it happened",
        complexity: "advanced",
      },
      {
        name: "Inventory Optimisation at Scale",
        description: "Pre-positioned stock in 21 warehouses based on pincode-level demand forecasts",
        complexity: "advanced",
      },
      {
        name: "Dynamic Discount Optimisation",
        description: "Calculated minimum discount needed per SKU to clear inventory without over-discounting",
        complexity: "intermediate",
      },
      {
        name: "Customer Segmentation for Targeting",
        description: "Sent early access to high-CLV customers and personalized deal notifications by segment",
        complexity: "intermediate",
      },
    ],
    the_solution: `Flipkart built a pre-sale demand
intelligence system that ingests
wishlist, search, and browse data
to forecast demand 2-3 weeks ahead.
Inventory is pre-positioned across
warehouses by pincode demand cluster.
Server infrastructure scales
automatically using demand forecasts
as triggers — not reactive auto-scaling
but predictive pre-scaling.`,
    outcome: [
      { metric: "Sale revenue", result: "₹50,000 crore+ in 5 days", timeframe: "2023" },
      { metric: "On-time delivery", result: "95% during peak sale", timeframe: "Big Billion Days 2023" },
      { metric: "Seller participation", result: "1.4M sellers, 150M products", timeframe: "2023 sale" },
    ],
    key_lesson: `Demand sensing — using pre-purchase
signals to predict sale demand —
is more valuable than historical
forecasting for event-driven retail.
What customers do before they buy
tells you more than what they bought
last year.`,
    discussion_starters: [
      "Flipkart uses wishlist data to forecast demand. If 500M wishlist adds result in 85M orders, what is the wishlist-to-purchase conversion rate? How would you use this to set inventory levels?",
      "They pre-position inventory across 21 warehouses before demand is confirmed. Calculate the cost of being wrong: if you over-stock by 20% on ₹10,000 crore of inventory at 15% holding cost, what is the annual cost?",
      "Big Billion Days gives early access to high-CLV customers. Design the customer segmentation: what metrics define \"high CLV\" for an e-commerce customer, and what is the RFM profile you would target?",
      "Dynamic discount optimisation sets minimum discounts per SKU. Ethically, if Flipkart knows a customer will buy at 20% off but shows them a 40% discount, is that honest pricing?",
    ],
    ba_topics: ["inventory_control", "supply_chain_kpis", "customer_seg_clv", "forecasting_methods", "promo_optimization"],
  },
  {
    id: "linkedin",
    company: "LinkedIn",
    industry: "Professional Network & HR Tech",
    country: "USA",
    year: "2023",
    logo_letter: "Li",
    unit_color: "#2563eb",
    tagline: "The algorithm that decides who gets hired",
    hero_metric: {
      value: "8",
      label: "Jobs filled per minute",
      context: "powered by skills-based matching analytics",
    },
    the_problem: `LinkedIn has 950 million members
and 58,000 companies hiring.
The matching problem: a recruiter
posts a job and gets 500 applications.
A job seeker applies to 50 jobs
and hears back from 2.
Both sides are overwhelmed.
LinkedIn's challenge: build
a two-sided matching system
that surfaces the right candidate
to the right recruiter —
before either of them
even starts searching.`,
    data_used: [
      {
        type: "Profile & skills data",
        volume: "950M member profiles, 41,000 skills tracked",
        insight: "Skills adjacency graph revealed non-obvious career transitions with high success rates",
      },
      {
        type: "Job application outcomes",
        volume: "Billions of application + response events",
        insight: "Response rate by skill combination predicted job match quality better than job title",
      },
      {
        type: "Economic signals",
        volume: "Hiring rates by industry × location × role",
        insight: "LinkedIn Economic Graph predicted tech layoffs 6 months before they were announced",
      },
    ],
    ba_techniques: [
      {
        name: "Skills-based CLV for Members",
        description: "Predicted which members would become premium subscribers based on job-seeking intensity signals",
        complexity: "intermediate",
      },
      {
        name: "Two-sided Matching Analytics",
        description: "Scored job-candidate fit on 100+ dimensions to rank applicants and surface relevant jobs",
        complexity: "advanced",
      },
      {
        name: "A/B Testing on Feed Algorithm",
        description: "Tested engagement vs professional value tradeoff in feed — viral posts vs career-relevant content",
        complexity: "advanced",
      },
      {
        name: "Cohort Analysis for Skill Gaps",
        description: "Identified which skill additions most improved job offer rates for specific career paths",
        complexity: "intermediate",
      },
    ],
    the_solution: `LinkedIn built a Skills Graph connecting
41,000 skills across roles, industries,
and geographies. Their matching algorithm
ranks candidates not by job title
but by skills adjacency — finding
people who have 80% of a job's
required skills and can grow into
the rest. This surfaces non-obvious
candidates recruiters would never
find manually, while showing
job seekers roles they hadn't
considered.`,
    outcome: [
      { metric: "Job fills", result: "8 per minute globally", timeframe: "2023" },
      { metric: "Skills-first hiring adoption", result: "45% of hirers use skills filters", timeframe: "2023" },
      { metric: "Premium conversion", result: "39% revenue growth", timeframe: "2023" },
    ],
    key_lesson: `Job titles are a proxy for skills,
and a bad one. When LinkedIn moved
from title-matching to skill-matching,
application-to-interview rates improved
significantly. Analytics that goes
beneath surface labels to underlying
capability unlocks better decisions.`,
    discussion_starters: [
      "LinkedIn's algorithm ranks your profile for recruiters. What data points would you include in a CLV model for LinkedIn members, and how would you weight job-seeking intensity signals?",
      "They found skills adjacency predicts career success better than job titles. Design an A/B test to prove this: what is your hypothesis, control group, treatment, and success metric?",
      "LinkedIn's Economic Graph predicted tech layoffs 6 months early from hiring rate drops. Is it ethical for a platform to publish this prediction? What are the consequences of being wrong?",
      "Their feed A/B test found viral content drives more engagement than career content. If you were the BA lead, what metric would you optimize for, and how would you justify that to leadership?",
    ],
    ba_topics: ["customer_seg_clv", "ab_testing", "experimental_design", "text_sentiment", "churn_analytics"],
  },
];

const SUGGESTION_CARDS = [
  { icon: "insights", text: "Explain RFM Analysis to me" },
  { icon: "functions", text: "What is price elasticity?" },
  { icon: "timeline", text: "Help me understand CLV formula" },
  { icon: "movie", text: "Case study: How Netflix uses data" },
];

const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "/mcq", description: "Generate practice questions", action: "send" },
  { cmd: "/doc", description: "Search your uploaded document", action: "send" },
  { cmd: "/forge", description: "Open Concept Forge", action: "tool", tool: "forge" },
  { cmd: "/formula", description: "Open Formula Lab", action: "tool", tool: "formula" },
  { cmd: "/case", description: "Open Case Study", action: "tool", tool: "case" },
  { cmd: "/exam", description: "Open Exam Simulator", action: "tool", tool: "exam" },
  { cmd: "/brief", description: "Open Pre-class Brief", action: "tool", tool: "brief" },
  { cmd: "/graph", description: "View Knowledge Graph", action: "route" },
];

const COLORS = {
  bg: "#0a0a0f",
  sidebar: "#0d0d14",
  surface: "#111118",
  surfaceRaised: "#1a1a24",
  border: "#2a2a3a",
  primary: "#7c3aed",
  primaryHover: "#6d28d9",
  primaryGlow: "rgba(124, 58, 237, 0.15)",
  textPrimary: "#f0f0f5",
  textSecondary: "#8b8b9e",
  textMuted: "#4a4a5e",
  success: "#059669",
  warning: "#d97706",
  error: "#dc2626",
};

function timeLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function sanitizeMermaid(raw: string): string {
  let c = raw.trim().replace(/\r\n/g, "\n");

  // Strip markdown fences
  c = c.replace(/```mermaid|```/g, "").trim();

  // Fix "graph TDgraph LR" duplicate — strip the second graph directive
  c = c.replace(/^(graph\s+(?:TD|LR|TB|BT|RL))(\s*graph\s+(?:TD|LR|TB|BT|RL))+/m, "$1");

  // Remove ALL edge labels — main source of parse errors
  // -->|any text| → -->
  c = c.replace(/-->\s*\|[^|\n]*\|/g, "-->");

  // Fix node labels: remove numbers, parens, special chars
  c = c.replace(/\[([^\]]+)\]/g, (_, label: string) => {
    const clean = label
      .replace(/\([^)]*\)/g, "")
      .replace(/[#@%^&*+=~`|\\<>{}]/g, "")
      .replace(/\b\d+x\d+\b/gi, "")
      .replace(/\b\d+\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return "[" + (clean || "Step") + "]";
  });

  // Remove dangling arrows at end of lines
  c = c.replace(/-->\s*$/gm, "");

  // Remove blank lines
  c = c.split("\n").filter((l: string) => l.trim() !== "").join("\n");

  // Add graph directive ONLY if missing
  if (!/^(graph|flowchart)\s+(TD|LR|TB|BT|RL)/m.test(c)) {
    c = "graph TD\n" + c;
  }

  return c;
}

function MermaidChart({ chart, isStreaming }: { chart: string; isStreaming?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    // Wait until streaming is fully done before rendering
    if (isStreaming) return;
    if (!ref.current || rendered) return;
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;

    const render = async () => {
      try {
        const win = window as any;
        if (!win.mermaid) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";
            script.onload = () => resolve();
            script.onerror = () => reject();
            document.head.appendChild(script);
          });
        }
        win.mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose" });
        const { svg } = await win.mermaid.render(id, sanitizeMermaid(chart));
        if (ref.current) {
          ref.current.innerHTML = svg;
          setRendered(true);
        }
      } catch (e) {
        console.error("Mermaid error:", e);
        setError(true);
      }
    };

    render();
  }, [chart, isStreaming]);

  if (isStreaming) return (
    <div style={{ margin: "20px 0", borderRadius: 12, background: "#1b1b1b", border: "1px solid rgba(73,68,86,0.1)", padding: 24, minHeight: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ color: "#444", fontSize: 12, fontFamily: "Manrope, sans-serif" }}>Diagram loading…</span>
    </div>
  );

  if (error) return (
    <div style={{ borderRadius: 12, background: "#1b1b1b", border: "1px solid rgba(73,68,86,0.2)", padding: 16, fontFamily: "monospace", fontSize: 13, color: "#958da2", whiteSpace: "pre-wrap" }}>
      {chart}
    </div>
  );

  return (
    <div ref={ref} style={{ margin: "20px 0", display: "flex", justifyContent: "center", overflowX: "auto", borderRadius: 12, background: "#1b1b1b", border: "1px solid rgba(73,68,86,0.1)", padding: 24, minHeight: 80 }}>
      <span style={{ color: "#333", fontSize: 12, fontFamily: "Manrope, sans-serif", alignSelf: "center" }}>Rendering diagram…</span>
    </div>
  );
}

function MessageMarkdown({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        code({ className, children, ...props }: any) {
          const match = /language-(\w+)/.exec(className || "");
          const lang = match?.[1]?.toLowerCase();
          const raw = String(children).replace(/\n$/, "").trim();
          const isBlock = String(children).includes("\n") || !!match;
          if (isBlock && lang === "mermaid") return <MermaidChart chart={raw} isStreaming={isStreaming} />;
          if (isBlock) {
            return (
              <pre style={{ margin: "12px 0", padding: "12px 14px", borderRadius: 10, background: COLORS.bg, border: `1px solid ${COLORS.border}`, overflowX: "auto", fontSize: 12, lineHeight: 1.6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}>
                <code>{raw}</code>
              </pre>
            );
          }
          return (
            <code style={{ background: COLORS.bg, color: "#c4b5fd", padding: "2px 6px", borderRadius: 6, fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }} {...props}>
              {children}
            </code>
          );
        },
        pre({ children }: any) {
          return <>{children}</>;
        },
        p({ children }: any) {
          return <p style={{ margin: "0 0 10px", color: COLORS.textPrimary }}>{children}</p>;
        },
        ul({ children }: any) {
          return <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>{children}</ul>;
        },
        ol({ children }: any) {
          return <ol style={{ margin: "0 0 10px", paddingLeft: 20 }}>{children}</ol>;
        },
        li({ children }: any) {
          return <li style={{ marginBottom: 4 }}>{children}</li>;
        },
        a({ children, href }: any) {
          return <a href={href} target="_blank" rel="noreferrer" style={{ color: "#c4b5fd" }}>{children}</a>;
        },
      }}
    >
      {preprocessLatex(content)}
    </ReactMarkdown>
  );
}

function preprocessLatex(content: string): string {
  // Escape currency dollar signs so they are not parsed as LaTeX delimiters.
  return content.replace(/\$(?=[\d,]+)/g, "\\$");
}

export default function BusinessAnalyticsPage() {
  const router = useRouter();
  const { user, token, clearAuth } = useAuthStore();
  const clearUser = clearAuth;
  const API = process.env.NEXT_PUBLIC_API_URL || "https://datalingo.in/api";

  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);
  const [mounted, setMounted] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolKey | null>(null);
  const [toolData, setToolData] = useState<ToolSignalData>({});
  const [suggestedTool, setSuggestedTool] = useState<string | null>(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [uploadedDoc, setUploadedDoc] = useState<UploadedDoc | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showUploadHint, setShowUploadHint] = useState(false);
  const [showMoreSheet, setShowMoreSheet] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [formulaCardIndex, setFormulaCardIndex] = useState(0);
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [announcements, setAnnouncements] = useState<Array<{ id: string; title: string; body: string; teacher_name: string; created_at: string }>>([]);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [toolPanelWidth, setToolPanelWidth] = useState(380);

  const [slashIndex, setSlashIndex] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());

  const [forgeTopic, setForgeTopic] = useState(BA_TOPICS[0]);
  const [forgeCustomTopic, setForgeCustomTopic] = useState("");
  const [forgeExplanation, setForgeExplanation] = useState("");
  const [forgeLoading, setForgeLoading] = useState(false);
  const [forgeResult, setForgeResult] = useState<ForgeResult | null>(null);

  const [fullscreenCase, setFullscreenCase] = useState<CaseStudy | null>(null);
  const [caseMessages, setCaseMessages] = useState<CaseChatMessage[]>([]);
  const [caseInput, setCaseInput] = useState("");
  const [caseStreaming, setCaseStreaming] = useState(false);
  const [caseCompletedIds, setCaseCompletedIds] = useState<Set<string>>(new Set());
  const [caseAbortController, setCaseAbortController] = useState<AbortController | null>(null);
  const [caseMobileTab, setCaseMobileTab] = useState<"case" | "chat">("case");

  const [examTopic, setExamTopic] = useState(BA_TOPICS[0]);
  const [examDifficulty, setExamDifficulty] = useState("intermediate");
  const [examLoading, setExamLoading] = useState(false);
  const [examQuestion, setExamQuestion] = useState<ExamQuestionData | null>(null);
  const [examAnswer, setExamAnswer] = useState("");
  const [examResult, setExamResult] = useState<ExamResultData | null>(null);
  const [examHintsOpen, setExamHintsOpen] = useState(false);
  const [examModelHintsOpen, setExamModelHintsOpen] = useState(false);

  const [briefTopic, setBriefTopic] = useState(BA_TOPICS[0]);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefData, setBriefData] = useState<BriefData | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const formulaScrollRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const toolResizeRef = useRef({ active: false, startX: 0, startWidth: 380 });
  const caseTextareaRef = useRef<HTMLTextAreaElement>(null);
  const caseMessagesScrollRef = useRef<HTMLDivElement>(null);
  const caseMessagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth < 768);
      setIsTablet(window.innerWidth >= 768 && window.innerWidth < 1024);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setShowMobileSidebar(false);
      return;
    }
    setSidebarCollapsed(false);
  }, [isMobile]);

  const sidebarNav = [
    { key: "chat", icon: "chat_bubble", label: "Chat" },
    { key: "graph", icon: "account_tree", label: "Knowledge Graph" },
  ];

  const sidebarTools = [
    { key: "forge", icon: "psychology", label: "Concept Forge" },
    { key: "formula", icon: "calculate", label: "Formula Lab" },
    { key: "case", icon: "cases", label: "Case Study" },
    { key: "exam", icon: "quiz", label: "Exam Simulator" },
    { key: "brief", icon: "auto_awesome", label: "Pre-class Brief" },
  ];

  const displayName = user?.name || user?.username || "Student";
  const firstName = (displayName || "Student").split(" ")[0];

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return `Good morning, ${firstName}.`;
    if (h >= 12 && h < 17) return `Good afternoon, ${firstName}.`;
    if (h >= 17 && h < 21) return `Good evening, ${firstName}.`;
    return `Hello, ${firstName}.`;
  }, [firstName]);

  const filteredSlashCommands = useMemo(() => {
    if (!slashFilter.trim()) return SLASH_COMMANDS;
    const q = slashFilter.toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.cmd.slice(1).includes(q) || c.description.toLowerCase().includes(q));
  }, [slashFilter]);

  useEffect(() => {
    if (slashIndex >= filteredSlashCommands.length) {
      setSlashIndex(0);
    }
  }, [filteredSlashCommands.length, slashIndex]);

  useEffect(() => {
    messageScrollRef.current?.scrollTo({ top: messageScrollRef.current.scrollHeight, behavior: "smooth" });
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  useEffect(() => {
    caseMessagesScrollRef.current?.scrollTo({ top: caseMessagesScrollRef.current.scrollHeight, behavior: "smooth" });
    caseMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [caseMessages, caseStreaming]);

  useEffect(() => {
    if (fullscreenCase) {
      setCaseMobileTab("case");
    }
  }, [fullscreenCase]);

  useEffect(() => {
    if (!isMobile) return;
    const handleResize = () => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isMobile]);

  useEffect(() => {
    if (activeTool === "formula") {
      setFormulaCardIndex(0);
      formulaScrollRef.current?.scrollTo({ left: 0, behavior: "auto" });
    }
  }, [activeTool]);

  useEffect(() => {
    if (activeTool === "formula") {
      const formula = String(toolData?.formula || "").toLowerCase();
      const map: Record<string, number> = { rfm: 0, clv: 1, ped: 2, eoq: 3, churn: 4 };
      const idx = map[formula];
      if (idx === undefined) return;
      setFormulaCardIndex(idx);
      const el = formulaScrollRef.current;
      if (el) {
        const cardWidth = el.clientWidth + 12;
        el.scrollTo({ left: cardWidth * idx, behavior: "smooth" });
      }
    }
  }, [activeTool, toolData]);

  const fetchRecentSessions = useCallback(async () => {
    await new Promise((r) => setTimeout(r, 50));
    if (!token) {
      setRecentSessions([]);
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };

    try {
      const primary = await fetch(`${API}/chat/sessions`, { headers });
      if (!primary.ok) {
        setRecentSessions([]);
        return;
      }

      const rows = await primary.json().catch(() => []);

      if (!Array.isArray(rows)) {
        setRecentSessions([]);
        return;
      }
      const normalized = rows
        .map((s: any) => ({
          id: String(s?.id || ""),
          title: String(s?.title || "Untitled chat"),
          created_at: s?.created_at,
          updated_at: s?.updated_at,
        }))
        .filter((s: RecentSession) => !!s.id)
        .slice(0, 40);
      setRecentSessions(normalized);
    } catch {
      setRecentSessions([]);
    }
  }, [API, token]);

  const fetchAnnouncements = useCallback(async () => {
    if (!token) {
      setAnnouncements([]);
      return;
    }
    try {
      const res = await fetch(
        `${API}/analytics/announcements?course=business_analytics`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setAnnouncements(Array.isArray(data) ? data.filter((a: any) => a.is_active) : []);
      }
    } catch {
      setAnnouncements([]);
    }
  }, [API, token]);

  const loadSessionMessages = useCallback(async (sid: string) => {
    if (!token || !sid) return;
    try {
      const res = await fetch(`${API}/chat/sessions/${sid}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const rows = await res.json().catch(() => []);
      if (!Array.isArray(rows)) return;

      const mapped: ChatMessage[] = rows.map((m: any) => ({
        id: String(m?.id || crypto.randomUUID()),
        role: (m?.role === "user" ? "user" : "assistant") as MessageRole,
        content: String(m?.content || ""),
        timestamp: String(m?.created_at || new Date().toISOString()),
        sources: Array.isArray(m?.sources) ? m.sources : [],
        isComplete: true,
      }));

      sessionIdRef.current = sid;
      setSessionId(sid);
      setMessages(mapped);
      setCompletedIds(new Set(mapped.map((m) => m.id)));
      setActiveTool(null);
    } catch {
      // silent
    }
  }, [API, token]);

  const startNewChat = useCallback(async () => {
    setMessages([]);
    setCompletedIds(new Set());
    setInput("");
    setActiveTool(null);
    setToolData({});
    setSuggestedTool(null);
    setUploadedDoc(null);
    setPendingDeleteSessionId(null);
    sessionIdRef.current = null;
    setSessionId(null);
    await fetchRecentSessions();
  }, [fetchRecentSessions]);

  const deleteSession = useCallback(async (sid: string) => {
    if (!token || deletingSessionId) return;

    setDeletingSessionId(sid);
    try {
      const res = await fetch(`${API}/chat/sessions/${sid}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("delete failed");

      if (sessionIdRef.current === sid || sessionId === sid) {
        setMessages([]);
        setInput("");
        setActiveTool(null);
        sessionIdRef.current = null;
        setSessionId(null);
      }

      setPendingDeleteSessionId(null);
      await fetchRecentSessions();
    } catch {
      // Keep silent to avoid interrupting chat flow.
    } finally {
      setDeletingSessionId(null);
    }
  }, [API, deletingSessionId, fetchRecentSessions, sessionId, token]);

  useEffect(() => {
    if (!mounted) return;
    if (token === undefined) return;
    if (!token) {
      router.replace("/login");
      return;
    }

    let alive = true;
    const boot = async () => {
      await new Promise((r) => setTimeout(r, 50));
      if (!alive) return;
      await Promise.all([fetchRecentSessions(), fetchAnnouncements()]);
    };

    boot();
    return () => {
      alive = false;
    };
  }, [mounted, token, router, fetchRecentSessions, fetchAnnouncements]);

  const adjustTextareaHeight = useCallback(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 88)}px`;
  }, []);

  const startToolPanelResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isMobile || !activeTool) return;
    toolResizeRef.current = {
      active: true,
      startX: e.clientX,
      startWidth: toolPanelWidth,
    };
    e.preventDefault();
    e.stopPropagation();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [activeTool, isMobile, toolPanelWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!toolResizeRef.current.active) return;
      const dx = toolResizeRef.current.startX - e.clientX;
      const next = Math.max(280, Math.min(560, toolResizeRef.current.startWidth + dx));
      setToolPanelWidth(next);
    };

    const onMouseUp = () => {
      if (!toolResizeRef.current.active) return;
      toolResizeRef.current.active = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  const toTopicId = useCallback((topicLabel: string) => {
    return topicLabel
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/\//g, " ")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  useEffect(() => {
    if (!uploadError) return;
    const timer = setTimeout(() => setUploadError(null), 4000);
    return () => clearTimeout(timer);
  }, [uploadError]);

  const handleCopy = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {
      // clipboard failures are non-blocking for chat
    });
  }, []);

  const doSendMessage = useCallback(async (actualText: string, options?: { appendUser?: boolean }) => {
    if (!token) return;
    const appendUser = options?.appendUser ?? true;

    const assistantId = crypto.randomUUID();

    setMessages((prev) => {
      const next = [...prev];
      if (appendUser) {
        next.push({
          id: crypto.randomUUID(),
          role: "user",
          content: actualText,
          timestamp: new Date().toISOString(),
          isComplete: true,
        });
      }
      next.push({
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
      });
      return next;
    });

    setIsStreaming(true);
    const controller = new AbortController();
    setAbortController(controller);

    let fullAccumulated = "";
    let displayed = "";
    const wordQueue: string[] = [];
    let dripping = false;
    let done = false;

    const stripCitations = (text: string) => text.replace(/\[\[?\d+(?:,\s*\d+)*\]?\]/g, "");

    try {
      let sessionToSend = sessionIdRef.current || sessionId;
      if (!sessionToSend) {
        sessionToSend = crypto.randomUUID();
        sessionIdRef.current = sessionToSend;
        setSessionId(sessionToSend);
      }

      const res = await fetch(`${API}/chat/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          message: actualText,
          session_id: sessionToSend,
        }),
      });

      if (!res.ok || !res.body) throw new Error("chat stream failed");

      const maybeSession = res.headers.get("X-Session-ID");
      if (maybeSession && !sessionIdRef.current) {
        sessionIdRef.current = maybeSession;
        setSessionId(maybeSession);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      const drip = () => {
        if (wordQueue.length === 0) {
          dripping = false;
          return;
        }
        dripping = true;
        const next = wordQueue.shift() || "";
        displayed += next;
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: stripCitations(displayed) } : m)));
        setTimeout(drip, 22);
      };

      const processSsePayload = (raw: string) => {
        const rawForControl = raw.trim();
        if (rawForControl === "[DONE]") {
          done = true;
          return;
        }

        if (rawForControl.startsWith("[TOOL_SIGNAL]")) {
          try {
            const signal = JSON.parse(rawForControl.slice(13));
            if (signal.type === "tool_activate") {
              setActiveTool(signal.tool as ToolKey);
              setToolData(signal.tool_data || {});
              setSuggestedTool(null);
            } else if (signal.type === "tool_suggest") {
              setSuggestedTool(signal.tool || null);
            }
          } catch {
            // ignore malformed tool signals
          }
          return;
        }

        try {
          const parsed = JSON.parse(rawForControl);
          if (parsed.session_id && !sessionIdRef.current) {
            sessionIdRef.current = parsed.session_id;
            setSessionId(parsed.session_id);
          }

          if (parsed.token !== undefined && parsed.token !== null) {
            const tokenText = String(parsed.token);
            fullAccumulated += tokenText;
            const words = tokenText.split(/(?<=\s)|(?=\s)/).filter(Boolean);
            wordQueue.push(...words);
            if (!dripping) drip();
          }

          if (parsed.sources) {
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, sources: parsed.sources } : m)));
          }
        } catch {
          // BA orchestrator streams plain text tokens as raw SSE data.
          fullAccumulated += raw;
          const words = raw.split(/(?<=\s)|(?=\s)/).filter(Boolean);
          wordQueue.push(...words);
          if (!dripping) drip();
        }
      };

      while (!done) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) {
          sseBuffer += decoder.decode();
        } else {
          const chunk = decoder.decode(value, { stream: true });
          sseBuffer += chunk;
        }

        sseBuffer = sseBuffer.replace(/\r\n/g, "\n");

        let boundary = sseBuffer.indexOf("\n\n");
        while (boundary !== -1) {
          const eventBlock = sseBuffer.slice(0, boundary);
          sseBuffer = sseBuffer.slice(boundary + 2);

          const dataLines = eventBlock
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => (line.startsWith("data: ") ? line.slice(6) : line.slice(5)));

          if (dataLines.length > 0) {
            processSsePayload(dataLines.join("\n"));
            if (done) break;
          }

          boundary = sseBuffer.indexOf("\n\n");
        }

        if (streamDone) {
          if (!done && sseBuffer.includes("data:")) {
            const dataLines = sseBuffer
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => (line.startsWith("data: ") ? line.slice(6) : line.slice(5)));
            if (dataLines.length > 0) {
              processSsePayload(dataLines.join("\n"));
            }
          }
          break;
        }
      }

      await new Promise<void>((resolve) => {
        const check = () => {
          if (wordQueue.length === 0 && !dripping) {
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: stripCitations(fullAccumulated) } : m)));
      setCompletedIds((prev) => new Set([...prev, assistantId]));
      await new Promise((resolve) => setTimeout(resolve, 16));
      setIsStreaming(false);
      setAbortController(null);
      fetchRecentSessions();
    } catch (err: any) {
      if (err?.name === "AbortError") {
        const abortedContent = stripCitations(fullAccumulated || displayed);
        if (abortedContent) {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: abortedContent } : m)));
          setCompletedIds((prev) => new Set([...prev, assistantId]));
        }
        setIsStreaming(false);
        setAbortController(null);
        return;
      }
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: "Something went wrong. Please try again." } : m)));
      setCompletedIds((prev) => new Set([...prev, assistantId]));
      setIsStreaming(false);
      setAbortController(null);
    }
  }, [API, fetchRecentSessions, sessionId, token]);

  const openCaseStudy = useCallback((study: CaseStudy) => {
    setFullscreenCase(study);
    setCaseMessages([]);
    setCaseCompletedIds(new Set());
    setCaseInput("");
    setCaseStreaming(false);
    caseAbortController?.abort();
    setCaseAbortController(null);
  }, [caseAbortController]);

  const sendCaseMessage = useCallback(async (rawMessage?: string) => {
    if (!token || !fullscreenCase || caseStreaming) return;

    const text = (rawMessage ?? caseInput).trim();
    if (!text) return;

    const assistantId = crypto.randomUUID();
    const historyPayload = caseMessages.slice(-6).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setCaseMessages((prev) => ([
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: text, timestamp: new Date().toISOString() },
      { id: assistantId, role: "assistant", content: "", timestamp: new Date().toISOString() },
    ]));
    setCaseInput("");
    setCaseStreaming(true);

    const controller = new AbortController();
    setCaseAbortController(controller);

    let fullAccumulated = "";
    let displayed = "";
    const wordQueue: string[] = [];
    let dripping = false;
    let done = false;
    let sseBuffer = "";

    const drip = () => {
      if (wordQueue.length === 0) {
        dripping = false;
        return;
      }
      dripping = true;
      const next = wordQueue.shift() || "";
      displayed += next;
      setCaseMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: displayed } : m)));
      setTimeout(drip, 22);
    };

    const processSsePayload = (raw: string) => {
      const rawControl = raw.trim();
      if (rawControl === "[DONE]") {
        done = true;
        return;
      }

      fullAccumulated += raw;
      const words = raw.split(/(?<=\s)|(?=\s)/).filter(Boolean);
      wordQueue.push(...words);
      if (!dripping) drip();
    };

    try {
      const res = await fetch(`${API}/ba/tools/case-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          case_id: fullscreenCase.id,
          case_company: fullscreenCase.company,
          case_context: JSON.stringify({
            the_problem: fullscreenCase.the_problem,
            ba_techniques: fullscreenCase.ba_techniques,
            outcome: fullscreenCase.outcome,
            key_lesson: fullscreenCase.key_lesson,
          }),
          message: text,
          history: historyPayload,
          session_id: sessionId || "",
        }),
      });

      if (!res.ok || !res.body) throw new Error("case chat stream failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (!done) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) {
          sseBuffer += decoder.decode();
        } else {
          sseBuffer += decoder.decode(value, { stream: true });
        }

        sseBuffer = sseBuffer.replace(/\r\n/g, "\n");

        let boundary = sseBuffer.indexOf("\n\n");
        while (boundary !== -1) {
          const eventBlock = sseBuffer.slice(0, boundary);
          sseBuffer = sseBuffer.slice(boundary + 2);

          const dataLines = eventBlock
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => (line.startsWith("data: ") ? line.slice(6) : line.slice(5)));

          if (dataLines.length > 0) {
            processSsePayload(dataLines.join("\n"));
            if (done) break;
          }

          boundary = sseBuffer.indexOf("\n\n");
        }

        if (streamDone) {
          if (!done && sseBuffer.includes("data:")) {
            const dataLines = sseBuffer
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => (line.startsWith("data: ") ? line.slice(6) : line.slice(5)));
            if (dataLines.length > 0) {
              processSsePayload(dataLines.join("\n"));
            }
          }
          break;
        }
      }

      await new Promise<void>((resolve) => {
        const check = () => {
          if (wordQueue.length === 0 && !dripping) {
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      setCaseMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: fullAccumulated } : m)));
      setCaseCompletedIds((prev) => new Set([...prev, assistantId]));
      await new Promise((resolve) => setTimeout(resolve, 16));
      setCaseStreaming(false);
      setCaseAbortController(null);
    } catch (err: any) {
      if (err?.name === "AbortError") {
        const abortedContent = fullAccumulated || displayed;
        if (abortedContent) {
          setCaseMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: abortedContent } : m)));
          setCaseCompletedIds((prev) => new Set([...prev, assistantId]));
        }
        setCaseStreaming(false);
        setCaseAbortController(null);
        return;
      } else {
        setCaseMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: "Something went wrong. Please try again." } : m)));
        setCaseCompletedIds((prev) => new Set([...prev, assistantId]));
        setCaseStreaming(false);
        setCaseAbortController(null);
      }
    }
  }, [API, caseInput, caseMessages, caseStreaming, fullscreenCase, sessionId, token]);

  const handleCaseInputKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await sendCaseMessage();
    }
  }, [sendCaseMessage]);

  const commitEditedMessage = useCallback(async () => {
    if (isStreaming || !editingMessageId) return;
    const nextContent = editingContent.trim();
    if (!nextContent) return;

    const idx = messages.findIndex((msg) => msg.id === editingMessageId);
    if (idx < 0) return;

    setMessages((prev) => {
      const target = prev[idx];
      if (!target) return prev;
      const updated = {
        ...target,
        content: nextContent,
        timestamp: new Date().toISOString(),
      };
      return [...prev.slice(0, idx), updated];
    });

    setEditingMessageId(null);
    setEditingContent("");
    await doSendMessage(nextContent, { appendUser: false });
  }, [doSendMessage, editingContent, editingMessageId, isStreaming, messages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");
    setShowSlashMenu(false);

    const lower = text.toLowerCase();

    if (lower === "/graph" || lower.startsWith("/graph ")) {
      router.push("/business-analytics/graph");
      return;
    }

    if (lower === "/forge" || lower.startsWith("/forge ")) {
      setSuggestedTool(null);
      setActiveTool("forge");
      return;
    }

    if (lower === "/formula" || lower.startsWith("/formula ")) {
      setSuggestedTool(null);
      setActiveTool("formula");
      return;
    }

    if (lower === "/case" || lower.startsWith("/case ")) {
      setSuggestedTool(null);
      setActiveTool("case");
      return;
    }

    if (lower === "/exam" || lower.startsWith("/exam ")) {
      setSuggestedTool(null);
      setActiveTool("exam");
      return;
    }

    if (lower === "/brief" || lower.startsWith("/brief ")) {
      setSuggestedTool(null);
      setActiveTool("brief");
      return;
    }

    if (lower.startsWith("/doc")) {
      const docQuestion = text.slice(4).trim();
      if (!uploadedDoc) {
        setUploadError("No document uploaded yet. Use the paperclip to upload a file first.");
        return;
      }

      const docMessage = docQuestion ? `[DOC_ONLY] ${docQuestion}` : "[DOC_ONLY] What is this document about?";
      await doSendMessage(docMessage);
      return;
    }

    await doSendMessage(text);
  }, [input, isStreaming, router, doSendMessage, uploadedDoc]);

  const selectSlashCommand = useCallback((command: SlashCommand) => {
    if (command.action === "route") {
      router.push("/business-analytics/graph");
      setShowSlashMenu(false);
      setInput("");
      return;
    }

    if (command.action === "tool" && command.tool) {
      setSuggestedTool(null);
      setActiveTool(command.tool);
      setShowSlashMenu(false);
      setInput("");
      return;
    }

    setInput(`${command.cmd} `);
    setShowSlashMenu(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [router]);

  const handleTextKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu && filteredSlashCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((v) => (v + 1) % filteredSlashCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((v) => (v - 1 + filteredSlashCommands.length) % filteredSlashCommands.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const cmd = filteredSlashCommands[slashIndex];
        if (cmd) selectSlashCommand(cmd);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await sendMessage();
    }
  }, [showSlashMenu, filteredSlashCommands, slashIndex, selectSlashCommand, sendMessage]);

  const uploadFile = useCallback(async (file: File) => {
    if (!token) return;

    if (file.size > 20 * 1024 * 1024) {
      setUploadError("File too large (max 20MB)");
      return;
    }

    const sid = sessionIdRef.current || sessionId || crypto.randomUUID();
    if (!sessionIdRef.current) {
      sessionIdRef.current = sid;
    }
    if (!sessionId) {
      setSessionId(sid);
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API}/ba/documents/upload?session_id=${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({}));
        const detail = typeof errorPayload?.detail === "string" ? errorPayload.detail : "Upload failed. Please try again.";
        throw new Error(detail);
      }

      const payload = await res.json().catch(() => ({}));
      setUploadedDoc({
        filename: payload.filename || file.name,
        doc_id: payload.doc_id,
        collection_id: payload.collection_id,
        summary: payload.summary,
        gemini_file_name: payload.gemini_file_name,
      });
    } catch (error: any) {
      setUploadError(error?.message || "Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [API, token, sessionId]);

  const removeDocument = useCallback(async () => {
    if (!sessionId || !token) {
      setUploadedDoc(null);
      return;
    }
    try {
      await fetch(`${API}/ba/documents/active?session_id=${sessionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Keep silent by design; local state still clears.
    }
    setUploadedDoc(null);
  }, [API, sessionId, token]);

  const handlePickFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
  }, [uploadFile]);

  const runForgeEvaluation = useCallback(async () => {
    const selectedTopicLabel = forgeTopic === CUSTOM_FORGE_TOPIC_VALUE ? forgeCustomTopic.trim() : forgeTopic;
    if (!forgeExplanation.trim() || !selectedTopicLabel || !token) return;
    setForgeLoading(true);
    setForgeResult(null);

    try {
      const res = await fetch(`${API}/ba/tools/forge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          topic_id: toTopicId(selectedTopicLabel),
          explanation: forgeExplanation,
          session_id: sessionIdRef.current || sessionId || "",
        }),
      });

      if (!res.ok) throw new Error("Evaluation failed");
      const data = await res.json();
      setForgeResult(data);
    } catch {
      setForgeResult({
        score: 0,
        overall: "",
        what_you_got_right: [],
        what_to_strengthen: [],
        corrected_explanation: "",
        error: "Failed to evaluate. Try again.",
      });
    } finally {
      setForgeLoading(false);
    }
  }, [API, forgeCustomTopic, forgeExplanation, forgeTopic, sessionId, toTopicId, token]);

  const runExamGenerate = useCallback(async () => {
    if (!token) return;
    setExamLoading(true);
    setExamQuestion(null);
    setExamAnswer("");
    setExamResult(null);
    setExamHintsOpen(false);
    setExamModelHintsOpen(false);

    try {
      const res = await fetch(`${API}/ba/tools/exam/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          topic_id: toTopicId(examTopic),
          difficulty: examDifficulty,
          session_id: sessionIdRef.current || sessionId || "",
        }),
      });

      if (!res.ok) throw new Error("Question generation failed");
      const data = await res.json();
      setExamQuestion(data);
    } catch {
      setExamQuestion({
        question: "Failed to generate question. Please try again.",
        hints: [],
        rubric: [],
      });
    } finally {
      setExamLoading(false);
    }
  }, [API, examDifficulty, examTopic, sessionId, toTopicId, token]);

  const submitExamAnswer = useCallback(async () => {
    if (!token || !examAnswer.trim() || !examQuestion?.question) return;
    setExamLoading(true);

    try {
      const res = await fetch(`${API}/ba/tools/exam/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          topic_id: toTopicId(examTopic),
          question: examQuestion.question,
          answer: examAnswer,
          session_id: sessionIdRef.current || sessionId || "",
        }),
      });

      if (!res.ok) throw new Error("Exam submission failed");
      const data = await res.json();
      setExamResult(data);
      setExamModelHintsOpen(false);
    } catch {
      setExamResult({
        score: 0,
        grade: "F",
        overall_feedback: "Failed to submit answer. Please try again.",
        rubric_breakdown: [],
        model_answer_hints: [],
        encourage: "",
      });
    } finally {
      setExamLoading(false);
    }
  }, [API, examAnswer, examQuestion, examTopic, sessionId, toTopicId, token]);

  const runBrief = useCallback(async () => {
    if (!token) return;
    setBriefLoading(true);
    setBriefData(null);
    try {
      const res = await fetch(`${API}/ba/tools/brief`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          topic_id: toTopicId(briefTopic),
          session_id: sessionIdRef.current || sessionId || "",
        }),
      });

      if (!res.ok) throw new Error("Brief generation failed");
      const data = await res.json();
      setBriefData(data);
    } catch {
      setBriefData(null);
    } finally {
      setBriefLoading(false);
    }
  }, [API, briefTopic, sessionId, toTopicId, token]);

  const formulaState = useMemo(() => {
    const r = 5;
    const f = 4;
    const m = 3;
    return {
      rfmRecency: r,
      rfmFrequency: f,
      rfmMonetary: m,
      clvAov: 1200,
      clvFrequency: 6,
      clvLifespan: 3,
      clvMargin: 0.32,
      pedPriceChange: 10,
      pedQtyChange: -18,
      eoqDemand: 24000,
      eoqOrdering: 1500,
      eoqHolding: 120,
      churnStart: 1200,
      churnLost: 120,
    };
  }, []);

  const [formulaInputs, setFormulaInputs] = useState(formulaState);

  const rfmScore = formulaInputs.rfmRecency * 100 + formulaInputs.rfmFrequency * 10 + formulaInputs.rfmMonetary;
  const clv = formulaInputs.clvAov * formulaInputs.clvFrequency * formulaInputs.clvLifespan * formulaInputs.clvMargin;
  const ped = formulaInputs.pedPriceChange === 0 ? 0 : formulaInputs.pedQtyChange / formulaInputs.pedPriceChange;
  const eoq = formulaInputs.eoqHolding <= 0 ? 0 : Math.sqrt((2 * formulaInputs.eoqDemand * formulaInputs.eoqOrdering) / formulaInputs.eoqHolding);
  const churn = formulaInputs.churnStart <= 0 ? 0 : (formulaInputs.churnLost / formulaInputs.churnStart) * 100;

  const rightPanelTitle = activeTool ? TOOL_LABELS[activeTool] : "";
  const desktopSidebarWidth = sidebarCollapsed ? (isTablet ? 68 : 72) : (isTablet ? 200 : 240);

  const recentDateLabel = useCallback((raw?: string) => {
    if (!raw) return "";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString([], { day: "2-digit", month: "short" });
  }, []);

  const trimTitle = useCallback((value: string) => {
    if (value.length <= 28) return value;
    return `${value.slice(0, 28)}...`;
  }, []);

  const complexityMeta: Record<"basic" | "intermediate" | "advanced", { line: string; pillBg: string; pillText: string }> = {
    basic: { line: "#059669", pillBg: "rgba(5,150,105,0.18)", pillText: "#34d399" },
    intermediate: { line: "#d97706", pillBg: "rgba(217,119,6,0.18)", pillText: "#fbbf24" },
    advanced: { line: "#7c3aed", pillBg: "rgba(124,58,237,0.18)", pillText: "#c4b5fd" },
  };

  if (!mounted) {
    return (
      <div style={{
        height: "100vh",
        background: "#0a0a0f",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{
          width: 32,
          height: 32,
          border: "2px solid #7c3aed",
          borderTopColor: "transparent",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }} />
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", width: "100%", overflow: "hidden", background: COLORS.bg, color: COLORS.textPrimary, display: "flex", fontFamily: "Manrope, sans-serif", position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');
        @import url('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css');
        * { box-sizing: border-box; }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .ba-input::placeholder {
          color: #4a4a5e;
        }
        .material-symbols-outlined {
          font-family: 'Material Symbols Outlined';
          font-style: normal;
          font-weight: normal;
          line-height: 1;
          letter-spacing: normal;
          text-transform: none;
          display: inline-block;
          white-space: nowrap;
          -webkit-font-feature-settings: 'liga';
          -webkit-font-smoothing: antialiased;
        }
        @media (max-width: 767px) {
          .ba-tool-scroll input,
          .ba-tool-scroll select,
          .ba-tool-scroll textarea {
            font-size: 16px !important;
          }
          .ba-tool-scroll button {
            min-height: 44px;
          }
        }
        .ba-recent-scroll {
          scrollbar-width: thin;
          scrollbar-color: #3a3a52 transparent;
        }
        .ba-recent-scroll::-webkit-scrollbar {
          width: 8px;
        }
        .ba-recent-scroll::-webkit-scrollbar-thumb {
          background: #3a3a52;
          border-radius: 999px;
        }
        .ba-no-select {
          user-select: none;
          -webkit-user-select: none;
        }
      `}</style>

      {!isMobile && (
        <div style={{ width: desktopSidebarWidth, height: "100vh", background: COLORS.sidebar, borderRight: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column", zIndex: 20, transition: "width 0.2s ease" }}>
          <div style={{ height: 48, padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Icon name="school" size={24} color={COLORS.primary} />
              {!sidebarCollapsed && <span style={{ fontSize: 16, fontWeight: 700, color: COLORS.textPrimary, fontFamily: "Manrope, sans-serif" }}>Datalingo</span>}
            </div>
            <button
              onClick={() => setSidebarCollapsed((v) => !v)}
              style={{ width: 30, height: 30, border: "none", borderRadius: 8, background: "transparent", color: COLORS.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <Icon name={sidebarCollapsed ? "right_panel_open" : "left_panel_close"} size={18} color="currentColor" />
            </button>
          </div>

          <div style={{ padding: "0 8px" }}>
            <button
              onClick={() => {
                setPendingDeleteSessionId(null);
                startNewChat();
              }}
              style={{ width: "100%", height: 36, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surfaceRaised, color: COLORS.textPrimary, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: sidebarCollapsed ? "center" : "center", gap: 6, cursor: "pointer", fontFamily: "Manrope, sans-serif", padding: sidebarCollapsed ? 0 : "0 10px" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = COLORS.border; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = COLORS.surfaceRaised; }}
            >
              <Icon name="add" size={16} color={COLORS.textPrimary} />
              {!sidebarCollapsed && "New Chat"}
            </button>
          </div>

          <div style={{ marginTop: 8, padding: "0 8px" }}>
            {sidebarNav.map((item) => {
              const active = item.key === "chat" ? activeTool === null : false;
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    if (item.key === "graph") {
                      router.push("/business-analytics/graph");
                      return;
                    }
                    setPendingDeleteSessionId(null);
                    setActiveTool(null);
                  }}
                  style={{ width: "100%", height: 36, margin: "2px 0", padding: sidebarCollapsed ? "0" : "0 12px", borderRadius: 8, border: "none", background: active ? COLORS.surfaceRaised : "transparent", color: active ? COLORS.textPrimary : COLORS.textMuted, display: "flex", alignItems: "center", justifyContent: sidebarCollapsed ? "center" : "flex-start", gap: 10, fontSize: 13, cursor: "pointer", textAlign: "left", fontFamily: "Manrope, sans-serif" }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = COLORS.surfaceRaised;
                      e.currentTarget.style.color = COLORS.textSecondary;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = COLORS.textMuted;
                    }
                  }}
                >
                  <Icon name={item.icon} size={18} color={active ? COLORS.textPrimary : COLORS.textMuted} />
                  {!sidebarCollapsed && item.label}
                </button>
              );
            })}
          </div>

          <div style={{ borderTop: `1px solid ${COLORS.border}`, margin: "8px 16px" }} />

          <div style={{ padding: "0 8px" }}>
            {!sidebarCollapsed && <div style={{ padding: "8px 12px 4px", fontSize: 10, fontWeight: 600, color: COLORS.textMuted, letterSpacing: "0.08em" }}>TOOLS</div>}
            {sidebarTools.map((item) => {
              const active = activeTool === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    setPendingDeleteSessionId(null);
                    setActiveTool(item.key as ToolKey);
                  }}
                  style={{ width: "100%", height: 36, margin: "2px 0", padding: sidebarCollapsed ? "0" : "0 12px", borderRadius: 8, border: "none", background: active ? COLORS.surfaceRaised : "transparent", color: active ? COLORS.primary : COLORS.textMuted, display: "flex", alignItems: "center", justifyContent: sidebarCollapsed ? "center" : "flex-start", gap: 10, fontSize: 13, cursor: "pointer", textAlign: "left", fontFamily: "Manrope, sans-serif" }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = COLORS.surfaceRaised;
                      e.currentTarget.style.color = COLORS.textSecondary;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = COLORS.textMuted;
                    }
                  }}
                >
                  <Icon name={item.icon} size={18} color={active ? COLORS.primary : COLORS.textMuted} />
                  {!sidebarCollapsed && item.label}
                </button>
              );
            })}
          </div>

          {!sidebarCollapsed && recentSessions.length > 0 && (
            <div style={{ padding: "0 8px", marginTop: 8, flex: 1, minHeight: 0, overflow: "hidden" }}>
              <div style={{ padding: "8px 12px 4px", fontSize: 10, fontWeight: 600, color: COLORS.textMuted, letterSpacing: "0.08em" }}>RECENT</div>
              <div className="ba-recent-scroll" style={{ overflowY: "auto", maxHeight: "100%", paddingRight: 2 }}>
                {recentSessions.map((s) => {
                  const active = sessionId === s.id;
                  const isPendingDelete = pendingDeleteSessionId === s.id;
                  const isDeleting = deletingSessionId === s.id;
                  return (
                    <div
                      key={s.id}
                      style={{ width: "100%", background: active ? COLORS.surfaceRaised : "transparent", borderRadius: 8, margin: "2px 0", border: `1px solid ${active ? COLORS.border : "transparent"}` }}
                      onMouseEnter={(e) => {
                        if (!active) e.currentTarget.style.background = COLORS.surfaceRaised;
                      }}
                      onMouseLeave={(e) => {
                        if (!active) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                          onClick={() => loadSessionMessages(s.id)}
                          style={{ flex: 1, border: "none", background: "transparent", padding: "8px 10px", cursor: "pointer", textAlign: "left", fontFamily: "Manrope, sans-serif" }}
                        >
                          <div style={{ fontSize: 13, color: active ? COLORS.textPrimary : COLORS.textSecondary, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{trimTitle(s.title || "Untitled chat")}</div>
                          <div style={{ marginTop: 2, fontSize: 11, color: COLORS.textMuted }}>{recentDateLabel(s.updated_at || s.created_at)}</div>
                        </button>
                        <button
                          onClick={() => setPendingDeleteSessionId((curr) => (curr === s.id ? null : s.id))}
                          style={{ width: 28, height: 28, marginRight: 8, border: "none", borderRadius: 7, background: "transparent", color: isPendingDelete ? COLORS.error : COLORS.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                          aria-label="Delete session"
                        >
                          <Icon name="delete" size={16} color="currentColor" />
                        </button>
                      </div>

                      {isPendingDelete && (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 10px 8px", borderTop: `1px solid ${COLORS.border}` }}>
                          <span style={{ fontSize: 11, color: COLORS.textSecondary }}>Delete this chat?</span>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              onClick={() => deleteSession(s.id)}
                              disabled={isDeleting}
                              style={{ border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11, background: COLORS.error, color: "#fff", cursor: isDeleting ? "not-allowed" : "pointer", opacity: isDeleting ? 0.7 : 1 }}
                            >
                              {isDeleting ? "Deleting" : "Delete"}
                            </button>
                            <button
                              onClick={() => setPendingDeleteSessionId(null)}
                              style={{ border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "4px 8px", fontSize: 11, background: "transparent", color: COLORS.textSecondary, cursor: "pointer" }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ marginTop: "auto", borderTop: `1px solid ${COLORS.border}`, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: sidebarCollapsed ? 0 : 10, justifyContent: sidebarCollapsed ? "center" : "flex-start" }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: COLORS.primary, color: "#fff", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {(firstName[0] || "S").toUpperCase()}
              </div>
              {!sidebarCollapsed && (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: COLORS.textPrimary, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</div>
                  <div style={{ fontSize: 11, color: COLORS.textMuted }}>student</div>
                </div>
              )}
              <button
                onClick={() => {
                  clearUser();
                  router.push("/login");
                }}
                style={{ width: 32, height: 32, border: "none", borderRadius: 8, background: "transparent", color: COLORS.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = COLORS.textPrimary; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = COLORS.textMuted; }}
              >
                <Icon name="logout" size={18} color="currentColor" />
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: COLORS.bg, overflow: "hidden" }}>
        <div style={{ height: 52, borderBottom: `1px solid ${COLORS.border}`, padding: isMobile ? "0 12px" : "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", background: COLORS.bg }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isMobile && (
              <button
                onClick={() => setShowMobileSidebar(true)}
                style={{ width: 32, height: 32, border: "none", borderRadius: 8, background: "transparent", color: COLORS.textMuted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                aria-label="Open history"
              >
                <Icon name="menu" size={20} color="currentColor" />
              </button>
            )}
            <div style={{ width: 8, height: 8, borderRadius: 999, background: COLORS.primary, animation: isStreaming ? "pulse 1.2s ease-in-out infinite" : "none" }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>DataLingo BA</span>
            {!isMobile && <span style={{ fontSize: 13, color: COLORS.textMuted }}>·</span>}
            {!isMobile && <span style={{ fontSize: 13, color: COLORS.primary }}>{activeTool ? TOOL_LABELS[activeTool] : "Chat"}</span>}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {uploadedDoc && (
              <div
                title={uploadedDoc.summary || uploadedDoc.filename}
                style={{
                  maxWidth: isMobile ? 140 : 320,
                  width: "auto",
                  minHeight: 28,
                  padding: isMobile ? "0 8px" : "5px 10px",
                  borderRadius: 999,
                  border: `1px solid ${COLORS.border}`,
                  background: COLORS.surfaceRaised,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  color: COLORS.textSecondary,
                  fontSize: 12,
                }}
              >
                <Icon name="description" size={14} color={COLORS.textSecondary} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: isMobile ? 72 : 180 }}>
                  {uploadedDoc.filename.length > (isMobile ? 10 : 24) ? `${uploadedDoc.filename.slice(0, isMobile ? 10 : 24)}...` : uploadedDoc.filename}
                </span>
                <button
                  onClick={removeDocument}
                  style={{ border: "none", background: "transparent", color: COLORS.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                  aria-label="Remove active document"
                >
                  <Icon name="close" size={14} color="currentColor" />
                </button>
              </div>
            )}
            {!isMobile && <span style={{ color: COLORS.textMuted, fontSize: 12 }}>{messages.length} messages</span>}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
          <div ref={messageScrollRef} style={{ flex: 1, overflowY: "auto", padding: isMobile ? "16px" : isTablet ? "20px 24px" : "24px 40px", paddingBottom: isMobile ? 180 : 130 }}>
            {messages.length === 0 ? (
              <div style={{ paddingTop: isMobile ? 30 : 80, paddingBottom: 60 }}>
                {announcements.length > 0 && messages.length === 0 && (
                  <div style={{ marginBottom: 20 }}>
                    {announcements.slice(0, 2).map(ann => (
                      <div key={ann.id} style={{
                        background: "rgba(124,58,237,0.08)",
                        border: "1px solid rgba(124,58,237,0.2)",
                        borderLeft: "3px solid #7c3aed",
                        borderRadius: "0 10px 10px 0",
                        padding: "12px 16px",
                        marginBottom: 8,
                      }}>
                        <div style={{
                          fontSize: 12, fontWeight: 700,
                          color: "#7c3aed", marginBottom: 4
                        }}>
                          📢 {ann.title}
                        </div>
                        <div style={{
                          fontSize: 13, color: "#c0c0d0", lineHeight: 1.6
                        }}>
                          {ann.body}
                        </div>
                        <div style={{
                          marginTop: 6, fontSize: 11, color: "#4a4a5e"
                        }}>
                          {ann.teacher_name} · {new Date(ann.created_at)
                            .toLocaleDateString([], { day: "2-digit", month: "short" })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {uploadedDoc && (
                  <div style={{ background: "#7c3aed11", border: "1px solid #7c3aed33", borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <Icon name="description" size={16} color="#7c3aed" />
                      <span style={{ fontSize: 13, color: "#a78bfa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {uploadedDoc.filename} is ready - ask anything about it
                      </span>
                    </div>
                    <button
                      onClick={removeDocument}
                      style={{ border: "none", background: "transparent", color: "#a78bfa", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                      aria-label="Remove active document"
                    >
                      <Icon name="close" size={14} color="currentColor" />
                    </button>
                  </div>
                )}
                <h1 style={{ margin: "0 0 8px", fontFamily: "Newsreader, Georgia, serif", fontStyle: "italic", fontSize: isMobile ? 28 : 40, fontWeight: 400, color: COLORS.textPrimary }}>
                  {greeting}
                </h1>
                <p style={{ margin: "0 0 48px", fontFamily: "Newsreader, Georgia, serif", fontStyle: "italic", fontSize: isMobile ? 18 : 24, color: COLORS.textMuted }}>
                  What would you like to learn today?
                </p>

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, maxWidth: 600 }}>
                  {SUGGESTION_CARDS.map((card) => (
                    <button
                      key={card.text}
                      onClick={async () => {
                        setInput("");
                        await doSendMessage(card.text);
                        setTimeout(() => textareaRef.current?.focus(), 0);
                      }}
                      style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 12, textAlign: "left", transition: "all 0.15s ease" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = COLORS.primary;
                        e.currentTarget.style.background = COLORS.surfaceRaised;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = COLORS.border;
                        e.currentTarget.style.background = COLORS.surface;
                      }}
                    >
                      <div style={{ width: 32, height: 32, borderRadius: 999, background: COLORS.surfaceRaised, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Icon name={card.icon} size={17} color={COLORS.primary} />
                      </div>
                      <span style={{ fontSize: 14, color: COLORS.textSecondary, lineHeight: 1.4, fontFamily: "Manrope, sans-serif" }}>{card.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {uploadedDoc && (
                  <div style={{ position: "sticky", top: 0, zIndex: 3, alignSelf: "flex-start", marginBottom: 4 }}>
                    <div style={{ background: "#1a1a24", border: "1px solid #2a2a3a", borderRadius: 999, padding: "5px 10px", fontSize: 11, color: "#8b8b9e", display: "flex", alignItems: "center", gap: 8 }}>
                      <span>
                        {`📄 ${uploadedDoc.filename.length > 24 ? `${uploadedDoc.filename.slice(0, 24)}...` : uploadedDoc.filename} · Active`}
                      </span>
                      <button
                        onClick={removeDocument}
                        style={{ border: "none", background: "transparent", color: "#8b8b9e", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                        aria-label="Remove active document"
                      >
                        <Icon name="close" size={12} color="currentColor" />
                      </button>
                    </div>
                  </div>
                )}
                {messages.map((m, idx) => {
                  const isCurrentlyStreaming = isStreaming && m.role === "assistant" && idx === messages.length - 1 && !completedIds.has(m.id);
                  const isHovered = hoveredMessageId === m.id;
                  const copyKey = `${m.id}-copy`;
                  const copied = copiedId === copyKey;

                  if (m.role === "user") {
                    return (
                      <div
                        key={m.id}
                        onMouseEnter={() => setHoveredMessageId(m.id)}
                        onMouseLeave={() => setHoveredMessageId((prev) => (prev === m.id ? null : prev))}
                        style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", position: "relative" }}
                      >
                        <div style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 4, textAlign: "right" }}>
                          You · {timeLabel(m.timestamp)}
                        </div>

                        <div style={{ position: "relative", maxWidth: isMobile ? "88%" : isTablet ? "80%" : "72%" }}>
                          <div style={{ background: COLORS.primary, color: "#ffffff", borderRadius: "16px 16px 4px 16px", padding: "12px 16px", fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                            {editingMessageId === m.id ? (
                              <>
                                <textarea
                                  value={editingContent}
                                  onChange={(e) => setEditingContent(e.target.value)}
                                  onInput={(e) => {
                                    const el = e.currentTarget;
                                    el.style.height = "auto";
                                    el.style.height = `${Math.max(60, el.scrollHeight)}px`;
                                  }}
                                  onKeyDown={async (e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                      e.preventDefault();
                                      await commitEditedMessage();
                                    }
                                  }}
                                  style={{ width: "100%", minHeight: 60, resize: "vertical", border: `1px solid ${COLORS.border}`, background: "rgba(255,255,255,0.12)", color: "#ffffff", borderRadius: 8, padding: "8px 10px", lineHeight: 1.5, fontSize: 13, fontFamily: "Manrope, sans-serif" }}
                                />
                                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                                  <button
                                    onClick={commitEditedMessage}
                                    style={{ border: "none", background: COLORS.primary, color: "#fff", borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer" }}
                                  >
                                    Send
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingMessageId(null);
                                      setEditingContent("");
                                    }}
                                    style={{ border: "none", background: "transparent", color: COLORS.textSecondary, borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer" }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </>
                            ) : (
                              m.content
                            )}
                          </div>

                          {isHovered && editingMessageId !== m.id && !isStreaming && (
                            <button
                              onClick={() => {
                                setEditingMessageId(m.id);
                                setEditingContent(m.content);
                              }}
                              style={{ position: "absolute", top: 4, right: -28, border: "none", background: "transparent", color: "#8b8b9e", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = "#f0f0f5"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = "#8b8b9e"; }}
                              aria-label="Edit message"
                            >
                              <Icon name="edit" size={14} color="currentColor" />
                            </button>
                          )}

                          {isHovered && (
                            <button
                              onClick={() => handleCopy(copyKey, m.content)}
                              style={{ position: "absolute", left: 0, bottom: -24, borderRadius: 4, background: "#1a1a24", border: "1px solid #2a2a3a", fontSize: 11, color: copied ? "#059669" : "#4a4a5e", cursor: "pointer", padding: "3px 8px", display: "flex", alignItems: "center", gap: 4 }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = copied ? "#059669" : "#f0f0f5";
                                e.currentTarget.style.borderColor = "#7c3aed";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = copied ? "#059669" : "#4a4a5e";
                                e.currentTarget.style.borderColor = "#2a2a3a";
                              }}
                            >
                              <Icon name={copied ? "check" : "content_copy"} size={12} color="currentColor" />
                              {copied ? "Copied!" : "Copy"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={m.id}
                      onMouseEnter={() => setHoveredMessageId(m.id)}
                      onMouseLeave={() => setHoveredMessageId((prev) => (prev === m.id ? null : prev))}
                      style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", position: "relative" }}
                    >
                      <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 999, background: COLORS.primary }} />
                        <span style={{ color: COLORS.primary, fontWeight: 600 }}>DataLingo</span>
                        <span>·</span>
                        <span>{timeLabel(m.timestamp)}</span>
                      </div>

                      <div style={{ position: "relative", maxWidth: isMobile ? "88%" : isTablet ? "80%" : "82%" }}>
                        <div style={{ background: COLORS.surfaceRaised, color: COLORS.textPrimary, borderRadius: "16px 16px 16px 4px", padding: "14px 18px", fontSize: 14, lineHeight: 1.7, border: `1px solid ${COLORS.border}` }}>
                          {isCurrentlyStreaming ? (
                            <div
                              style={{
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                fontSize: 14,
                                lineHeight: 1.7,
                                color: COLORS.textPrimary,
                                fontFamily: "Manrope, sans-serif",
                              }}
                            >
                              {m.content}
                            </div>
                          ) : (
                            <MessageMarkdown content={m.content} isStreaming={false} />
                          )}
                        </div>

                        {isHovered && (
                          <button
                            onClick={() => handleCopy(copyKey, m.content)}
                            style={{ position: "absolute", right: 0, bottom: -24, borderRadius: 4, background: "#1a1a24", border: "1px solid #2a2a3a", fontSize: 11, color: copied ? "#059669" : "#4a4a5e", cursor: "pointer", padding: "3px 8px", display: "flex", alignItems: "center", gap: 4 }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color = copied ? "#059669" : "#f0f0f5";
                              e.currentTarget.style.borderColor = "#7c3aed";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = copied ? "#059669" : "#4a4a5e";
                              e.currentTarget.style.borderColor = "#2a2a3a";
                            }}
                          >
                            <Icon name={copied ? "check" : "content_copy"} size={12} color="currentColor" />
                            {copied ? "Copied!" : "Copy"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {isStreaming && (
                  <div style={{ display: "flex", alignItems: "flex-start" }}>
                    <div style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: "18px 18px 18px 4px", width: 52, height: 38, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                      {[0, 1, 2].map((i) => (
                        <span key={i} style={{ width: 6, height: 6, borderRadius: 999, background: COLORS.textSecondary, display: "inline-block", animation: `bounce 1s ${i * 0.12}s infinite` }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div style={{ position: "absolute", left: 0, right: 0, bottom: isMobile ? 52 : 0, background: COLORS.bg, padding: isMobile ? `6px 10px calc(6px + env(safe-area-inset-bottom))` : "6px 14px", borderTop: `1px solid ${COLORS.border}`, zIndex: 60 }}>
            <input ref={fileInputRef} type="file" style={{ display: "none" }} accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp" onChange={handlePickFile} />

            {suggestedTool && !activeTool && (
              <div style={{ marginBottom: 10, background: "#1a1a24", border: "1px solid #2a2a3a", borderRadius: 8, padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <button
                  onClick={() => {
                    setActiveTool(suggestedTool as ToolKey);
                    setSuggestedTool(null);
                  }}
                  style={{ border: "none", background: "transparent", color: "#8b8b9e", fontSize: 12, cursor: "pointer", textAlign: "left", padding: 0 }}
                >
                  DataLingo suggests trying the {TOOL_LABELS[suggestedTool as ToolKey] || suggestedTool} tool -&gt;
                </button>
                <button
                  onClick={() => setSuggestedTool(null)}
                  style={{ border: "none", background: "transparent", color: "#8b8b9e", cursor: "pointer", padding: 0, width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center" }}
                  aria-label="Dismiss suggestion"
                >
                  x
                </button>
              </div>
            )}

            <div style={{ position: "relative" }}>
              {uploadError && (
                <div style={{ position: "absolute", left: 0, right: 0, bottom: isMobile ? 76 : 82, background: "#dc262622", border: "1px solid #dc2626", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#fca5a5" }}>
                  {uploadError}
                </div>
              )}

              {showSlashMenu && input.startsWith("/") && (
                <div style={{ position: "absolute", left: 0, right: 0, bottom: isMobile ? 68 : 74, background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.4)", maxHeight: isMobile ? 240 : 280, overflowY: "auto" }}>
                  {filteredSlashCommands.length === 0 ? (
                    <div style={{ height: isMobile ? 48 : 40, padding: "0 16px", display: "flex", alignItems: "center", color: COLORS.textMuted, fontSize: 12 }}>
                      No matching commands
                    </div>
                  ) : (
                    filteredSlashCommands.map((c, i) => (
                      <button
                        key={c.cmd}
                        onMouseEnter={() => setSlashIndex(i)}
                        onClick={() => selectSlashCommand(c)}
                        style={{
                          width: "100%",
                          height: isMobile ? 48 : 40,
                          padding: "0 16px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          border: "none",
                          cursor: "pointer",
                          background: i === slashIndex ? COLORS.border : "transparent",
                        }}
                      >
                        <span style={{ color: COLORS.primary, fontWeight: 600, fontSize: isMobile ? 14 : 13 }}>{c.cmd}</span>
                        <span style={{ color: COLORS.textSecondary, fontSize: 12 }}>{c.description}</span>
                      </button>
                    ))
                  )}
                </div>
              )}

              <div
                style={{
                  background: COLORS.surfaceRaised,
                  border: `1px solid ${inputFocused ? COLORS.primary : COLORS.border}`,
                  borderRadius: 10,
                  padding: "6px 10px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  boxShadow: inputFocused ? "0 0 0 3px rgba(124,58,237,0.1)" : "none",
                  transition: "all 0.2s",
                }}
              >
                <button
                  onClick={() => fileInputRef.current?.click()}
                  title="Upload"
                  onMouseEnter={() => setShowUploadHint(true)}
                  onMouseLeave={() => setShowUploadHint(false)}
                  style={{ border: "none", background: "transparent", color: COLORS.textMuted, width: isMobile ? 40 : 22, height: isMobile ? 40 : 22, padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  {isUploading ? (
                    <span style={{ animation: "spin 0.9s linear infinite", display: "inline-flex" }}><Icon name="progress_activity" size={20} color={COLORS.primary} /></span>
                  ) : (
                    <Icon name="upload" size={18} color={COLORS.textMuted} />
                  )}
                </button>

                {showUploadHint && !isUploading && (
                  <div style={{ position: "absolute", left: 6, bottom: isMobile ? 50 : 44, background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "6px 8px", color: COLORS.textSecondary, fontSize: 11, whiteSpace: "nowrap" }}>
                    PDF, images, DOCX, TXT · Max 20MB
                  </div>
                )}

                <textarea
                  className="ba-input"
                  ref={textareaRef}
                  value={input}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  onChange={(e) => {
                    const val = e.target.value;
                    setInput(val);
                    if (val.startsWith("/")) {
                      setShowSlashMenu(true);
                      setSlashFilter(val.slice(1).trim());
                      setSlashIndex(0);
                    } else {
                      setShowSlashMenu(false);
                      setSlashFilter("");
                    }
                  }}
                  onKeyDown={handleTextKeyDown}
                  placeholder={isUploading ? "Uploading..." : "Ask anything..."}
                  style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: COLORS.textPrimary, fontSize: 12.5, fontFamily: "Manrope, sans-serif", resize: "none", minHeight: 16, maxHeight: 88, lineHeight: 1.45 }}
                />

                {isStreaming ? (
                  <button
                    onClick={() => {
                      abortController?.abort();
                      setIsStreaming(false);
                      setAbortController(null);
                    }}
                    style={{ width: 36, height: 36, border: "none", borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: "#dc2626", color: "#fff", cursor: "pointer", transition: "all 0.2s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#b91c1c"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "#dc2626"; }}
                    aria-label="Stop response"
                  >
                    <Icon name="stop" size={18} color="#fff" />
                  </button>
                ) : (
                  <button
                    onClick={sendMessage}
                    disabled={!input.trim()}
                    style={{ width: 30, height: 30, border: "none", borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: input.trim() ? COLORS.primary : COLORS.border, color: input.trim() ? "#fff" : COLORS.textMuted, cursor: input.trim() ? "pointer" : "not-allowed", transition: "all 0.2s" }}
                    onMouseEnter={(e) => {
                      if (input.trim()) {
                        e.currentTarget.style.background = COLORS.primaryHover;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (input.trim()) {
                        e.currentTarget.style.background = COLORS.primary;
                      }
                    }}
                  >
                    <Icon name="arrow_upward" size={18} color={input.trim() ? "#fff" : COLORS.textMuted} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {isMobile && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: `calc(52px + env(safe-area-inset-bottom))`, paddingBottom: "env(safe-area-inset-bottom)", background: COLORS.sidebar, borderTop: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-around", alignItems: "center", zIndex: 50 }}>
          {[
            { icon: "chat_bubble", label: "Chat", action: () => setActiveTool(null), active: activeTool === null },
            { icon: "history", label: "History", action: () => setShowMobileSidebar(true), active: showMobileSidebar },
            { icon: "psychology", label: "Forge", action: () => setActiveTool("forge"), active: activeTool === "forge" },
            { icon: "account_tree", label: "Graph", action: () => router.push("/business-analytics/graph"), active: false },
            { icon: "more_horiz", label: "More", action: () => setShowMoreSheet(true), active: showMoreSheet },
          ].map((item) => (
            <button key={item.label} onClick={item.action} style={{ minWidth: 44, minHeight: 44, border: "none", background: "transparent", color: item.active ? COLORS.primary : COLORS.textMuted, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, cursor: "pointer" }}>
              <Icon name={item.icon} size={22} color={item.active ? COLORS.primary : COLORS.textMuted} />
              <span style={{ fontSize: 9, fontWeight: 500 }}>{item.label}</span>
            </button>
          ))}
        </div>
      )}

      {isMobile && showMoreSheet && (
        <>
          <div onClick={() => setShowMoreSheet(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 149 }} />
          <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 150, background: COLORS.sidebar, borderTop: `1px solid ${COLORS.border}`, borderRadius: "16px 16px 0 0", padding: 16, animation: "slideUp 0.3s ease" }}>
            <div style={{ width: 32, height: 4, borderRadius: 2, background: COLORS.border, margin: "0 auto 16px" }} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              {[
                { icon: "calculate", label: "Formula", action: () => setActiveTool("formula") },
                { icon: "cases", label: "Cases", action: () => setActiveTool("case") },
                { icon: "quiz", label: "Exam", action: () => setActiveTool("exam") },
                { icon: "auto_awesome", label: "Brief", action: () => setActiveTool("brief") },
                { icon: "account_tree", label: "Graph", action: () => router.push("/business-analytics/graph") },
                { icon: "history", label: "History", action: () => setShowMobileSidebar(true) },
                { icon: "upload_file", label: "Upload Doc", action: () => fileInputRef.current?.click() },
                { icon: "logout", label: "Logout", action: () => { clearUser(); router.push("/login"); } },
              ].map((item) => (
                <button key={item.label} onClick={() => { item.action(); setShowMoreSheet(false); }} style={{ minHeight: 44, border: "none", borderRadius: 10, background: COLORS.surfaceRaised, color: COLORS.textSecondary, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: 12, cursor: "pointer" }}>
                  <Icon name={item.icon} size={22} color={COLORS.textSecondary} />
                  <span style={{ fontSize: 12 }}>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {isMobile && showMobileSidebar && (
        <>
          <div onClick={() => setShowMobileSidebar(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.58)", zIndex: 179 }} />
          <aside style={{ position: "fixed", top: 0, left: 0, bottom: 0, width: "86vw", maxWidth: 360, background: COLORS.sidebar, borderRight: `1px solid ${COLORS.border}`, zIndex: 180, display: "flex", flexDirection: "column" }}>
            <div style={{ height: 52, padding: "0 12px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="history" size={18} color={COLORS.primary} />
                <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.textPrimary }}>History</span>
              </div>
              <button
                onClick={() => setShowMobileSidebar(false)}
                style={{ width: 36, height: 36, border: "none", borderRadius: 8, background: "transparent", color: COLORS.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <Icon name="close" size={18} color="currentColor" />
              </button>
            </div>

            <div style={{ padding: 10 }}>
              <button
                onClick={() => {
                  setShowMobileSidebar(false);
                  startNewChat();
                }}
                style={{ width: "100%", height: 38, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.surfaceRaised, color: COLORS.textPrimary, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", fontFamily: "Manrope, sans-serif" }}
              >
                <Icon name="add" size={16} color={COLORS.textPrimary} />
                New Chat
              </button>
            </div>

            <div style={{ padding: "0 10px 6px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button
                  onClick={() => {
                    setShowMobileSidebar(false);
                    setActiveTool(null);
                  }}
                  style={{ minHeight: 38, border: `1px solid ${COLORS.border}`, borderRadius: 8, background: activeTool === null ? COLORS.surfaceRaised : "transparent", color: activeTool === null ? COLORS.textPrimary : COLORS.textSecondary, cursor: "pointer" }}
                >
                  Chat
                </button>
                <button
                  onClick={() => {
                    setShowMobileSidebar(false);
                    router.push("/business-analytics/graph");
                  }}
                  style={{ minHeight: 38, border: `1px solid ${COLORS.border}`, borderRadius: 8, background: "transparent", color: COLORS.textSecondary, cursor: "pointer" }}
                >
                  Graph
                </button>
              </div>
            </div>

            <div style={{ padding: "0 10px", marginBottom: 6 }}>
              <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                {sidebarTools.map((item) => {
                  const active = activeTool === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => {
                        setShowMobileSidebar(false);
                        setActiveTool(item.key as ToolKey);
                      }}
                      style={{ border: `1px solid ${active ? COLORS.primary : COLORS.border}`, borderRadius: 999, background: active ? COLORS.primary : "transparent", color: active ? "#fff" : COLORS.textSecondary, fontSize: 11, padding: "6px 10px", whiteSpace: "nowrap", cursor: "pointer" }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ borderTop: `1px solid ${COLORS.border}`, margin: "0 10px 8px" }} />

            <div style={{ flex: 1, minHeight: 0, padding: "0 10px 10px", display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "2px 4px 6px", fontSize: 10, fontWeight: 600, color: COLORS.textMuted, letterSpacing: "0.08em" }}>RECENT</div>
              <div className="ba-recent-scroll" style={{ overflowY: "auto", flex: 1, minHeight: 0, paddingRight: 2 }}>
                {recentSessions.length === 0 && (
                  <div style={{ color: COLORS.textMuted, fontSize: 12, padding: "10px 6px" }}>No recent chats yet.</div>
                )}
                {recentSessions.map((s) => {
                  const active = sessionId === s.id;
                  const isPendingDelete = pendingDeleteSessionId === s.id;
                  const isDeleting = deletingSessionId === s.id;
                  return (
                    <div key={s.id} style={{ background: active ? COLORS.surfaceRaised : "transparent", borderRadius: 8, border: `1px solid ${active ? COLORS.border : "transparent"}`, marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center" }}>
                        <button
                          onClick={() => {
                            setShowMobileSidebar(false);
                            loadSessionMessages(s.id);
                          }}
                          style={{ flex: 1, border: "none", background: "transparent", textAlign: "left", padding: "8px 10px", cursor: "pointer" }}
                        >
                          <div style={{ fontSize: 13, color: active ? COLORS.textPrimary : COLORS.textSecondary, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{trimTitle(s.title || "Untitled chat")}</div>
                          <div style={{ marginTop: 2, fontSize: 11, color: COLORS.textMuted }}>{recentDateLabel(s.updated_at || s.created_at)}</div>
                        </button>
                        <button
                          onClick={() => setPendingDeleteSessionId((curr) => (curr === s.id ? null : s.id))}
                          style={{ width: 30, height: 30, border: "none", borderRadius: 7, marginRight: 8, background: "transparent", color: isPendingDelete ? COLORS.error : COLORS.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                        >
                          <Icon name="delete" size={16} color="currentColor" />
                        </button>
                      </div>
                      {isPendingDelete && (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, padding: "0 10px 8px", borderTop: `1px solid ${COLORS.border}` }}>
                          <span style={{ fontSize: 11, color: COLORS.textSecondary }}>Delete this chat?</span>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              onClick={() => deleteSession(s.id)}
                              disabled={isDeleting}
                              style={{ border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11, background: COLORS.error, color: "#fff", cursor: isDeleting ? "not-allowed" : "pointer", opacity: isDeleting ? 0.7 : 1 }}
                            >
                              {isDeleting ? "Deleting" : "Delete"}
                            </button>
                            <button
                              onClick={() => setPendingDeleteSessionId(null)}
                              style={{ border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "4px 8px", fontSize: 11, background: "transparent", color: COLORS.textSecondary, cursor: "pointer" }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        </>
      )}

      {isMobile && activeTool && (
        <div onClick={() => setActiveTool(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 199 }} />
      )}

      <div style={isMobile ? { position: "fixed", left: 0, right: 0, bottom: 0, height: "85vh", zIndex: 200, background: COLORS.sidebar, borderTop: `1px solid ${COLORS.border}`, borderRadius: "20px 20px 0 0", overflow: "hidden", transform: activeTool ? "translateY(0)" : "translateY(100%)", transition: "transform 0.3s ease", pointerEvents: activeTool ? "auto" : "none", animation: activeTool ? "slideUp 0.3s ease" : "none", display: "flex", flexDirection: "column" } : { width: activeTool ? toolPanelWidth : 0, opacity: activeTool ? 1 : 0, overflow: "hidden", transition: "width 0.25s ease, opacity 0.25s ease", background: COLORS.sidebar, borderLeft: activeTool ? `1px solid ${COLORS.border}` : "none", display: "flex", flexDirection: "column", position: "relative", flexShrink: 0 }}>
        {activeTool && (
          <>
            {!isMobile && (
              <div
                onMouseDown={startToolPanelResize}
                style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 14, cursor: "col-resize", zIndex: 4, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0))" }}
                aria-label="Resize tools panel"
              >
                <div style={{ width: 3, height: 48, borderRadius: 999, background: COLORS.border }} />
              </div>
            )}
            {isMobile && <div style={{ width: 32, height: 4, borderRadius: 2, background: COLORS.border, margin: "12px auto 0" }} />}
            <div style={{ minHeight: 52, borderBottom: `1px solid ${COLORS.border}`, padding: isMobile ? "0 16px" : "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: COLORS.sidebar }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>{rightPanelTitle}</div>
              <button onClick={() => setActiveTool(null)} style={{ border: "none", background: "transparent", color: COLORS.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44 }}>
                <Icon name="close" size={18} color={COLORS.textMuted} />
              </button>
            </div>

            <div className="ba-tool-scroll" style={{ flex: 1, overflowY: "auto", padding: isMobile ? 16 : 14 }}>
              {activeTool === "forge" && (
                <div>
                  <label style={{ display: "block", fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Pick a topic</label>
                  <select value={forgeTopic} onChange={(e) => setForgeTopic(e.target.value)} style={{ width: "100%", background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 8, padding: "8px 12px", marginBottom: 14 }}>
                    {BA_TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
                    <option value={CUSTOM_FORGE_TOPIC_VALUE}>Custom topic...</option>
                  </select>

                  {forgeTopic === CUSTOM_FORGE_TOPIC_VALUE && (
                    <input
                      value={forgeCustomTopic}
                      onChange={(e) => setForgeCustomTopic(e.target.value)}
                      placeholder="Enter any BA topic"
                      style={{ width: "100%", background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 8, padding: "8px 12px", marginBottom: 14 }}
                    />
                  )}

                  <label style={{ display: "block", fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Explain it in your own words</label>
                  <textarea value={forgeExplanation} onChange={(e) => setForgeExplanation(e.target.value)} placeholder="Pretend you're explaining this to a friend who has never studied business analytics..." style={{ width: "100%", minHeight: 120, resize: "vertical", background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 10, color: COLORS.textPrimary, padding: "10px 12px", lineHeight: 1.6, fontSize: 13, marginBottom: 12 }} />

                  <button onClick={runForgeEvaluation} disabled={forgeLoading || !forgeExplanation.trim() || (forgeTopic === CUSTOM_FORGE_TOPIC_VALUE && !forgeCustomTopic.trim())} style={{ width: "100%", background: COLORS.primary, color: "#fff", border: "none", borderRadius: 8, padding: 10, fontWeight: 600, cursor: forgeLoading || !forgeExplanation.trim() || (forgeTopic === CUSTOM_FORGE_TOPIC_VALUE && !forgeCustomTopic.trim()) ? "not-allowed" : "pointer", opacity: forgeLoading || !forgeExplanation.trim() || (forgeTopic === CUSTOM_FORGE_TOPIC_VALUE && !forgeCustomTopic.trim()) ? 0.6 : 1 }}>
                    {forgeLoading ? "Analyzing..." : "Evaluate My Understanding"}
                  </button>

                  {!forgeResult && !forgeLoading && (
                    <div style={{ marginTop: 12, background: COLORS.surface, border: `1px dashed ${COLORS.border}`, borderRadius: 10, padding: 12, color: COLORS.textSecondary, fontSize: 12 }}>
                      Submit your explanation to get a real score and targeted feedback.
                    </div>
                  )}

                  {forgeResult && (
                    <div style={{ marginTop: 14, border: `1px solid ${COLORS.border}`, borderRadius: 10, background: COLORS.surfaceRaised, padding: 12 }}>
                      {forgeResult.error ? (
                        <div style={{ color: COLORS.error, fontSize: 13 }}>{forgeResult.error}</div>
                      ) : (
                        <>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                            <span style={{ fontSize: 12, color: COLORS.textSecondary }}>Score</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: forgeResult.score <= 4 ? COLORS.error : forgeResult.score <= 7 ? COLORS.warning : COLORS.success }}>{forgeResult.score}/10</span>
                          </div>
                          <div style={{ color: COLORS.textPrimary, fontSize: 13, lineHeight: 1.6, marginBottom: 10 }}>{forgeResult.overall}</div>

                          <div style={{ marginBottom: 8 }}>
                            <div style={{ color: COLORS.success, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>What you got right</div>
                            {(forgeResult.what_you_got_right || []).map((item) => <div key={item} style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 2 }}>• {item}</div>)}
                          </div>

                          <div style={{ marginBottom: 10 }}>
                            <div style={{ color: COLORS.warning, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>What to strengthen</div>
                            {(forgeResult.what_to_strengthen || []).map((item) => <div key={item} style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 2 }}>• {item}</div>)}
                          </div>

                          {!!forgeResult.corrected_explanation && (
                            <div style={{ color: COLORS.textSecondary, fontSize: 12, fontStyle: "italic", marginBottom: 10 }}>
                              {forgeResult.corrected_explanation}
                            </div>
                          )}
                        </>
                      )}

                      <button onClick={() => { setForgeResult(null); setForgeExplanation(""); }} style={{ border: `1px solid ${COLORS.border}`, background: COLORS.bg, color: COLORS.textPrimary, borderRadius: 8, padding: "8px 10px", cursor: "pointer", width: "100%" }}>Try again</button>
                    </div>
                  )}
                </div>
              )}

              {activeTool === "formula" && (
                <div>
                  <div
                    ref={formulaScrollRef}
                    onScroll={(e) => {
                      if (!isMobile) return;
                      const el = e.currentTarget;
                      const cardWidth = el.clientWidth + 12;
                      const idx = Math.round(el.scrollLeft / cardWidth);
                      setFormulaCardIndex(Math.max(0, Math.min(4, idx)));
                    }}
                    style={isMobile ? { display: "flex", gap: 12, overflowX: "auto", scrollSnapType: "x mandatory", paddingBottom: 6, WebkitOverflowScrolling: "touch" } : {}}
                  >
                  <div style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16, marginBottom: isMobile ? 0 : 12, minWidth: isMobile ? "100%" : "auto", scrollSnapAlign: isMobile ? "start" : undefined }}>
                    <div style={{ fontWeight: 600, color: COLORS.textPrimary }}>RFM Score</div>
                    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", color: COLORS.primary, fontSize: 13, margin: "8px 0" }}>RFM = R×100 + F×10 + M</div>
                    {[{ k: "rfmRecency", label: "Recency score (1-5)" }, { k: "rfmFrequency", label: "Frequency score (1-5)" }, { k: "rfmMonetary", label: "Monetary score (1-5)" }].map((f) => (
                      <input
                        key={f.k}
                        type="number"
                        value={(formulaInputs as any)[f.k]}
                        min={1}
                        max={5}
                        onChange={(e) => setFormulaInputs((prev) => ({ ...prev, [f.k]: Number(e.target.value || 0) }))}
                        style={{ width: "100%", marginBottom: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 6, padding: isMobile ? "10px 12px" : "6px 10px", minHeight: 44 }}
                        placeholder={f.label}
                      />
                    ))}
                    <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.primary }}>{rfmScore}</div>
                    <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>{rfmScore === 111 ? "Worst segment" : rfmScore === 555 ? "Best champion" : "Higher is better"}</div>
                  </div>

                  <div style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16, marginBottom: isMobile ? 0 : 12, minWidth: isMobile ? "100%" : "auto", scrollSnapAlign: isMobile ? "start" : undefined }}>
                    <div style={{ fontWeight: 600, color: COLORS.textPrimary }}>Customer Lifetime Value (CLV)</div>
                    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", color: COLORS.primary, fontSize: 13, margin: "8px 0" }}>CLV = AOV × frequency × lifespan × margin</div>
                    {[
                      { k: "clvAov", label: "Average order value" },
                      { k: "clvFrequency", label: "Purchase frequency per year" },
                      { k: "clvLifespan", label: "Customer lifespan years" },
                      { k: "clvMargin", label: "Gross margin (0-1)" },
                    ].map((f) => (
                      <input
                        key={f.k}
                        type="number"
                        value={(formulaInputs as any)[f.k]}
                        step="any"
                        onChange={(e) => setFormulaInputs((prev) => ({ ...prev, [f.k]: Number(e.target.value || 0) }))}
                        style={{ width: "100%", marginBottom: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 6, padding: isMobile ? "10px 12px" : "6px 10px", minHeight: 44 }}
                        placeholder={f.label}
                      />
                    ))}
                    <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.primary }}>{clv.toFixed(2)}</div>
                    <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>Worth acquiring if CAC &lt; CLV</div>
                  </div>

                  <div style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16, marginBottom: isMobile ? 0 : 12, minWidth: isMobile ? "100%" : "auto", scrollSnapAlign: isMobile ? "start" : undefined }}>
                    <div style={{ fontWeight: 600, color: COLORS.textPrimary }}>Price Elasticity of Demand (PED)</div>
                    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", color: COLORS.primary, fontSize: 13, margin: "8px 0" }}>PED = %ΔQ / %ΔP</div>
                    <input type="number" value={formulaInputs.pedPriceChange} onChange={(e) => setFormulaInputs((prev) => ({ ...prev, pedPriceChange: Number(e.target.value || 0) }))} placeholder="Price change %" style={{ width: "100%", marginBottom: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 6, padding: isMobile ? "10px 12px" : "6px 10px", minHeight: 44 }} />
                    <input type="number" value={formulaInputs.pedQtyChange} onChange={(e) => setFormulaInputs((prev) => ({ ...prev, pedQtyChange: Number(e.target.value || 0) }))} placeholder="Quantity change %" style={{ width: "100%", marginBottom: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 6, padding: isMobile ? "10px 12px" : "6px 10px", minHeight: 44 }} />
                    <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.primary }}>{ped.toFixed(2)}</div>
                    <div style={{ color: Math.abs(ped) > 1 ? COLORS.warning : COLORS.success, fontSize: 12 }}>{Math.abs(ped) > 1 ? "Elastic (|PED|>1)" : "Inelastic (|PED|<1)"}</div>
                  </div>

                  <div style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16, marginBottom: isMobile ? 0 : 12, minWidth: isMobile ? "100%" : "auto", scrollSnapAlign: isMobile ? "start" : undefined }}>
                    <div style={{ fontWeight: 600, color: COLORS.textPrimary }}>Economic Order Quantity (EOQ)</div>
                    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", color: COLORS.primary, fontSize: 13, margin: "8px 0" }}>EOQ = √(2DS/H)</div>
                    <input type="number" value={formulaInputs.eoqDemand} onChange={(e) => setFormulaInputs((prev) => ({ ...prev, eoqDemand: Number(e.target.value || 0) }))} placeholder="Annual demand" style={{ width: "100%", marginBottom: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 6, padding: isMobile ? "10px 12px" : "6px 10px", minHeight: 44 }} />
                    <input type="number" value={formulaInputs.eoqOrdering} onChange={(e) => setFormulaInputs((prev) => ({ ...prev, eoqOrdering: Number(e.target.value || 0) }))} placeholder="Ordering cost" style={{ width: "100%", marginBottom: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 6, padding: isMobile ? "10px 12px" : "6px 10px", minHeight: 44 }} />
                    <input type="number" value={formulaInputs.eoqHolding} onChange={(e) => setFormulaInputs((prev) => ({ ...prev, eoqHolding: Number(e.target.value || 0) }))} placeholder="Holding cost per unit" style={{ width: "100%", marginBottom: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 6, padding: isMobile ? "10px 12px" : "6px 10px", minHeight: 44 }} />
                    <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.primary }}>{Number.isFinite(eoq) ? eoq.toFixed(0) : "0"}</div>
                    <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>Order {Number.isFinite(eoq) ? eoq.toFixed(0) : "0"} units per order</div>
                  </div>

                  <div style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16, minWidth: isMobile ? "100%" : "auto", scrollSnapAlign: isMobile ? "start" : undefined }}>
                    <div style={{ fontWeight: 600, color: COLORS.textPrimary }}>Churn Rate</div>
                    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", color: COLORS.primary, fontSize: 13, margin: "8px 0" }}>Churn = (lost/start) × 100</div>
                    <input type="number" value={formulaInputs.churnStart} onChange={(e) => setFormulaInputs((prev) => ({ ...prev, churnStart: Number(e.target.value || 0) }))} placeholder="Customers start" style={{ width: "100%", marginBottom: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 6, padding: isMobile ? "10px 12px" : "6px 10px", minHeight: 44 }} />
                    <input type="number" value={formulaInputs.churnLost} onChange={(e) => setFormulaInputs((prev) => ({ ...prev, churnLost: Number(e.target.value || 0) }))} placeholder="Customers lost" style={{ width: "100%", marginBottom: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 6, padding: isMobile ? "10px 12px" : "6px 10px", minHeight: 44 }} />
                    <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.primary }}>{churn.toFixed(2)}%</div>
                    <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>Retention rate = {(100 - churn).toFixed(2)}%</div>
                  </div>
                  </div>

                  {isMobile && (
                    <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 10 }}>
                      {[0, 1, 2, 3, 4].map((idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            const el = formulaScrollRef.current;
                            if (!el) return;
                            el.scrollTo({ left: idx * (el.clientWidth + 12), behavior: "smooth" });
                            setFormulaCardIndex(idx);
                          }}
                          style={{ width: 8, height: 8, borderRadius: 999, border: "none", padding: 0, background: formulaCardIndex === idx ? COLORS.primary : COLORS.border, cursor: "pointer" }}
                          aria-label={`Go to formula card ${idx + 1}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTool === "case" && (
                <div>
                  <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 10 }}>
                    Explore real business analytics stories and open any case in immersive mode.
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {CASE_STUDIES.map((study) => (
                      <div key={study.id} style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                            <div style={{ width: 32, height: 32, borderRadius: "50%", background: study.unit_color, color: "#fff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                              {study.logo_letter}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{study.company}</div>
                              <div style={{ fontSize: 11, color: COLORS.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{study.industry}</div>
                            </div>
                          </div>
                          <span style={{ fontSize: 10, color: COLORS.textMuted, border: `1px solid ${COLORS.border}`, borderRadius: 999, padding: "3px 7px" }}>{study.year}</span>
                        </div>

                        <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 8, lineHeight: 1.5 }}>{study.tagline}</div>

                        <div style={{ background: "#111118", border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                          <div style={{ color: study.unit_color, fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{study.hero_metric.value}</div>
                          <div style={{ color: COLORS.textPrimary, fontSize: 12, fontWeight: 600, marginTop: 4 }}>{study.hero_metric.label}</div>
                          <div style={{ color: COLORS.textMuted, fontSize: 11, marginTop: 2 }}>{study.hero_metric.context}</div>
                        </div>

                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                          {study.ba_techniques.slice(0, 3).map((tech) => (
                            <span key={`${study.id}-${tech.name}`} style={{ fontSize: 10, color: "#ddd6fe", background: "rgba(124,58,237,0.18)", border: `1px solid ${COLORS.primary}`, borderRadius: 999, padding: "3px 8px" }}>
                              {tech.name}
                            </span>
                          ))}
                        </div>

                        <button
                          onClick={() => openCaseStudy(study)}
                          style={{ width: "100%", border: `1px solid ${COLORS.border}`, background: COLORS.bg, color: COLORS.textPrimary, borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "left" }}
                        >
                          Open Case →
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTool === "exam" && (
                <div>
                  <label style={{ display: "block", fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Topic</label>
                  <select value={examTopic} onChange={(e) => setExamTopic(e.target.value)} style={{ width: "100%", background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
                    {BA_TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>

                  <label style={{ display: "block", fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Difficulty</label>
                  <select value={examDifficulty} onChange={(e) => setExamDifficulty(e.target.value)} style={{ width: "100%", background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </select>

                  <button onClick={runExamGenerate} disabled={examLoading} style={{ width: "100%", background: COLORS.primary, color: "#fff", border: "none", borderRadius: 8, padding: 10, fontWeight: 600, cursor: examLoading ? "not-allowed" : "pointer", marginBottom: 12, opacity: examLoading ? 0.65 : 1 }}>
                    Generate Question
                  </button>

                  {examLoading && (
                    <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 10 }}>Generating question...</div>
                  )}

                  {!!examQuestion?.question && (
                    <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, background: COLORS.surfaceRaised, padding: 12, marginBottom: 12 }}>
                      <div style={{ color: COLORS.textPrimary, fontSize: 13, lineHeight: 1.6, marginBottom: 10 }}>{examQuestion.question}</div>

                      {!!examQuestion.hints?.length && (
                        <div style={{ marginBottom: 10 }}>
                          <button onClick={() => setExamHintsOpen((v) => !v)} style={{ border: "none", background: "transparent", color: COLORS.primary, cursor: "pointer", padding: 0, fontSize: 12, fontWeight: 600 }}>
                            {examHintsOpen ? "Hide hints" : "Show hints"}
                          </button>
                          {examHintsOpen && (
                            <div style={{ marginTop: 6 }}>
                              {(examQuestion.hints || []).map((h) => <div key={h} style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 3 }}>• {h}</div>)}
                            </div>
                          )}
                        </div>
                      )}

                      {!!examQuestion.rubric?.length && (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 6 }}>Rubric preview</div>
                          {(examQuestion.rubric || []).map((r, idx) => (
                            <div key={`${r.criterion}-${idx}`} style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 3 }}>
                              • {r.criterion} ({r.points} pts)
                            </div>
                          ))}
                        </div>
                      )}

                      <textarea value={examAnswer} onChange={(e) => setExamAnswer(e.target.value)} placeholder="Write your answer..." style={{ width: "100%", minHeight: 100, marginTop: 10, resize: "vertical", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.textPrimary, padding: "8px 10px", lineHeight: 1.6 }} />

                      <button onClick={submitExamAnswer} disabled={examLoading || !examAnswer.trim()} style={{ width: "100%", marginTop: 8, background: COLORS.primary, color: "#fff", border: "none", borderRadius: 8, padding: 10, cursor: examLoading || !examAnswer.trim() ? "not-allowed" : "pointer", opacity: examLoading || !examAnswer.trim() ? 0.65 : 1 }}>
                        {examLoading ? "Submitting..." : "Submit Answer"}
                      </button>

                      {examResult && (
                        <div style={{ marginTop: 10, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 10, background: COLORS.bg }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                            <div style={{ width: 62, height: 62, borderRadius: "50%", border: `2px solid ${examResult.grade === "A" || examResult.grade === "B" ? COLORS.success : examResult.grade === "C" ? COLORS.warning : COLORS.error}`, color: examResult.grade === "A" || examResult.grade === "B" ? COLORS.success : examResult.grade === "C" ? COLORS.warning : COLORS.error, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>
                              {examResult.score}
                            </div>
                            <div>
                              <div style={{ fontSize: 12, color: COLORS.textSecondary }}>Grade</div>
                              <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.textPrimary }}>{examResult.grade}</div>
                            </div>
                          </div>

                          <div style={{ color: COLORS.textPrimary, fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}>
                            {examResult.overall_feedback}
                          </div>

                          {!!examResult.rubric_breakdown?.length && (
                            <div style={{ marginBottom: 8 }}>
                              {(examResult.rubric_breakdown || []).map((r, idx) => (
                                <div key={`${r.criterion}-${idx}`} style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 4 }}>
                                  {r.achieved ? "✓" : "✕"} {r.criterion} - {r.feedback}
                                </div>
                              ))}
                            </div>
                          )}

                          {!!examResult.model_answer_hints?.length && (
                            <div style={{ marginBottom: 8 }}>
                              <button onClick={() => setExamModelHintsOpen((v) => !v)} style={{ border: "none", background: "transparent", color: COLORS.primary, cursor: "pointer", padding: 0, fontSize: 12, fontWeight: 600 }}>
                                {examModelHintsOpen ? "Hide model answer hints" : "Show model answer hints"}
                              </button>
                              {examModelHintsOpen && (
                                <div style={{ marginTop: 6 }}>
                                  {(examResult.model_answer_hints || []).map((hint) => (
                                    <div key={hint} style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 3 }}>• {hint}</div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {!!examResult.encourage && <div style={{ color: COLORS.success, fontSize: 12, marginBottom: 8 }}>{examResult.encourage}</div>}

                          <button onClick={() => { setExamQuestion(null); setExamAnswer(""); setExamResult(null); setExamHintsOpen(false); setExamModelHintsOpen(false); }} style={{ marginTop: 10, width: "100%", border: `1px solid ${COLORS.border}`, background: COLORS.surfaceRaised, color: COLORS.textPrimary, borderRadius: 8, padding: "8px 10px", cursor: "pointer" }}>Next Question</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTool === "brief" && (
                <div>
                  <label style={{ display: "block", fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>Topic</label>
                  <select value={briefTopic} onChange={(e) => setBriefTopic(e.target.value)} style={{ width: "100%", background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
                    {BA_TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>

                  <button onClick={runBrief} style={{ width: "100%", background: COLORS.primary, color: "#fff", border: "none", borderRadius: 8, padding: 10, fontWeight: 600, cursor: "pointer", marginBottom: 12 }}>
                    Generate Brief
                  </button>

                  {briefLoading && (
                    <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>Generating brief...</div>
                  )}

                  {briefData && (
                    <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden", background: COLORS.surfaceRaised }}>
                      <div style={{ padding: 12, borderBottom: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
                        <span style={{ fontSize: 11, color: COLORS.textSecondary, border: `1px solid ${COLORS.border}`, borderRadius: 999, padding: "4px 8px" }}>
                          ~{briefData.read_time_minutes || 5} min prep
                        </span>
                      </div>
                      <div style={{ padding: 12, borderBottom: `1px solid ${COLORS.border}`, background: "rgba(5,150,105,0.12)" }}>
                        <div style={{ color: COLORS.success, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>What you already know</div>
                        {(briefData.what_you_know || []).map((item) => <div key={item} style={{ color: COLORS.textPrimary, fontSize: 12, lineHeight: 1.6, marginBottom: 2 }}>• {item}</div>)}
                      </div>
                      <div style={{ padding: 12, borderBottom: `1px solid ${COLORS.border}`, background: "rgba(59,130,246,0.12)" }}>
                        <div style={{ color: "#60a5fa", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>What&apos;s coming</div>
                        {(briefData.whats_coming || []).map((item, idx) => (
                          <div key={`${item.concept}-${idx}`} style={{ marginBottom: 6 }}>
                            <div style={{ color: COLORS.textPrimary, fontSize: 12, fontWeight: 600 }}>{item.concept}</div>
                            <div style={{ color: COLORS.textSecondary, fontSize: 12, lineHeight: 1.5 }}>{item.why_it_matters}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ padding: 12, borderBottom: `1px solid ${COLORS.border}`, background: "rgba(217,119,6,0.12)" }}>
                        <div style={{ color: COLORS.warning, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Watch out for</div>
                        {(briefData.watch_out_for || []).map((item, idx) => (
                          <div key={`${item.misconception}-${idx}`} style={{ marginBottom: 6 }}>
                            <div style={{ color: COLORS.textPrimary, fontSize: 12 }}>
                              {item.misconception} → {item.reality}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div style={{ padding: 12, background: "rgba(124,58,237,0.12)" }}>
                        <div style={{ color: COLORS.primary, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Key Formula</div>
                        <div style={{ color: COLORS.textPrimary, fontSize: 12, lineHeight: 1.6 }}>{briefData.key_formula?.name || "-"}</div>
                        {!!briefData.key_formula?.expression && <div style={{ color: COLORS.textSecondary, fontSize: 12, lineHeight: 1.6 }}>{briefData.key_formula.expression}</div>}
                        {!!briefData.key_formula?.plain_english && <div style={{ color: COLORS.textSecondary, fontSize: 12, lineHeight: 1.6 }}>{briefData.key_formula.plain_english}</div>}
                        {!!briefData.warm_up_question && <div style={{ marginTop: 8, color: "#a78bfa", fontSize: 12, fontStyle: "italic" }}>{briefData.warm_up_question}</div>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {fullscreenCase && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, background: COLORS.bg, animation: "slideUp 0.25s ease", display: "flex", flexDirection: "column" }}>
          {isMobile && (
            <div style={{ height: 48, display: "flex", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.sidebar }}>
              <button
                onClick={() => setCaseMobileTab("case")}
                style={{ flex: 1, border: "none", background: "transparent", color: caseMobileTab === "case" ? COLORS.textPrimary : COLORS.textMuted, fontSize: 13, fontWeight: 600, borderBottom: caseMobileTab === "case" ? `2px solid ${COLORS.primary}` : "2px solid transparent", cursor: "pointer" }}
              >
                Case
              </button>
              <button
                onClick={() => setCaseMobileTab("chat")}
                style={{ flex: 1, border: "none", background: "transparent", color: caseMobileTab === "chat" ? COLORS.textPrimary : COLORS.textMuted, fontSize: 13, fontWeight: 600, borderBottom: caseMobileTab === "chat" ? `2px solid ${COLORS.primary}` : "2px solid transparent", cursor: "pointer" }}
              >
                Ask AI
              </button>
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
            <div style={{ width: isMobile ? "100%" : "58%", display: !isMobile || caseMobileTab === "case" ? "flex" : "none", flexDirection: "column", borderRight: isMobile ? "none" : `1px solid ${COLORS.border}` }}>
              <div style={{ height: 56, background: COLORS.sidebar, borderBottom: `1px solid ${COLORS.border}`, padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: fullscreenCase.unit_color, color: "#fff", fontWeight: 700, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {fullscreenCase.logo_letter}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1.2 }}>{fullscreenCase.company}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
                      <span style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary, fontSize: 10, borderRadius: 999, padding: "2px 8px" }}>{fullscreenCase.industry}</span>
                      <span style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary, fontSize: 10, borderRadius: 999, padding: "2px 8px" }}>{fullscreenCase.country}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    caseAbortController?.abort();
                    setCaseAbortController(null);
                    setCaseStreaming(false);
                    setFullscreenCase(null);
                  }}
                  style={{ width: 36, height: 36, border: "none", borderRadius: 8, background: "transparent", color: COLORS.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                >
                  <Icon name="close" size={20} color="currentColor" />
                </button>
              </div>

              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: 40 }}>
                <div style={{ margin: 16, borderRadius: 12, border: `1px solid ${fullscreenCase.unit_color}44`, background: `linear-gradient(135deg, ${fullscreenCase.unit_color}22, ${fullscreenCase.unit_color}08)`, padding: 20 }}>
                  <div style={{ fontSize: isMobile ? 36 : 48, fontWeight: 800, color: fullscreenCase.unit_color, lineHeight: 1 }}>{fullscreenCase.hero_metric.value}</div>
                  <div style={{ marginTop: 8, fontSize: 16, fontWeight: 600, color: COLORS.textPrimary }}>{fullscreenCase.hero_metric.label}</div>
                  <div style={{ marginTop: 4, fontSize: 13, color: COLORS.textSecondary, fontStyle: "italic" }}>{fullscreenCase.hero_metric.context}</div>
                </div>

                <div style={{ padding: "0 24px", marginBottom: 24 }}>
                  <div style={{ fontSize: isMobile ? 18 : 20, fontFamily: "Newsreader, Georgia, serif", fontStyle: "italic", color: COLORS.textPrimary }}>{fullscreenCase.tagline}</div>
                </div>

                <div style={{ padding: "0 24px" }}>
                  <div style={{ background: `${fullscreenCase.unit_color}22`, color: fullscreenCase.unit_color, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 20, display: "inline-block" }}>THE PROBLEM</div>
                  <div style={{ fontSize: 14, color: "#c0c0d0", lineHeight: 1.8, padding: "12px 0" }}>{fullscreenCase.the_problem}</div>

                  <div style={{ marginTop: 8, background: `${fullscreenCase.unit_color}22`, color: fullscreenCase.unit_color, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 20, display: "inline-block" }}>DATA USED</div>
                  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                    {fullscreenCase.data_used.map((d) => (
                      <div key={`${fullscreenCase.id}-${d.type}`} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 14 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary }}>{d.type}</div>
                        <div style={{ marginTop: 4, fontSize: 11, color: COLORS.primary, fontWeight: 600 }}>{d.volume}</div>
                        <div style={{ marginTop: 6, fontSize: 12, color: COLORS.textSecondary, fontStyle: "italic", lineHeight: 1.5 }}>{d.insight}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: 18, background: `${fullscreenCase.unit_color}22`, color: fullscreenCase.unit_color, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 20, display: "inline-block" }}>BA TECHNIQUES</div>
                  <div style={{ marginTop: 12 }}>
                    {fullscreenCase.ba_techniques.map((tech) => {
                      const meta = complexityMeta[tech.complexity];
                      return (
                        <div key={`${fullscreenCase.id}-${tech.name}`} style={{ position: "relative", background: COLORS.surfaceRaised, borderLeft: `3px solid ${meta.line}`, borderRadius: "0 8px 8px 0", padding: "12px 14px", marginBottom: 8 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary }}>{tech.name}</div>
                          <span style={{ position: "absolute", top: 10, right: 10, fontSize: 10, textTransform: "capitalize", background: meta.pillBg, color: meta.pillText, borderRadius: 999, padding: "2px 7px" }}>{tech.complexity}</span>
                          <div style={{ marginTop: 6, fontSize: 12, color: COLORS.textSecondary, lineHeight: 1.5, paddingRight: 66 }}>{tech.description}</div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ marginTop: 12, background: `${fullscreenCase.unit_color}22`, color: fullscreenCase.unit_color, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 20, display: "inline-block" }}>THE SOLUTION</div>
                  <div style={{ fontSize: 14, color: "#c0c0d0", lineHeight: 1.8, padding: "12px 0" }}>{fullscreenCase.the_solution}</div>

                  <div style={{ marginTop: 8, background: `${fullscreenCase.unit_color}22`, color: fullscreenCase.unit_color, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 20, display: "inline-block" }}>OUTCOMES</div>
                  <div style={{ marginTop: 12, display: "flex", gap: 10, overflowX: isMobile ? "auto" : "visible" }}>
                    {fullscreenCase.outcome.map((o, idx) => (
                      <div key={`${fullscreenCase.id}-outcome-${idx}`} style={{ minWidth: isMobile ? 190 : 0, flex: isMobile ? "0 0 auto" : 1, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 14, textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: COLORS.textSecondary, textTransform: "uppercase", letterSpacing: "0.08em" }}>{o.metric}</div>
                        <div style={{ marginTop: 8, fontSize: 20, fontWeight: 800, color: fullscreenCase.unit_color }}>{o.result}</div>
                        <div style={{ marginTop: 6, fontSize: 11, color: COLORS.textMuted, fontStyle: "italic" }}>{o.timeframe}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: 18, color: fullscreenCase.unit_color, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em" }}>KEY LESSON</div>
                  <div style={{ marginTop: 6, background: `${fullscreenCase.unit_color}11`, border: `1px solid ${fullscreenCase.unit_color}33`, borderLeft: `4px solid ${fullscreenCase.unit_color}`, borderRadius: "0 10px 10px 0", padding: "16px 20px", fontSize: 14, color: COLORS.textPrimary, lineHeight: 1.7 }}>
                    {fullscreenCase.key_lesson}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ width: isMobile ? "100%" : "42%", display: !isMobile || caseMobileTab === "chat" ? "flex" : "none", flexDirection: "column" }}>
              <div style={{ height: 56, borderBottom: `1px solid ${COLORS.border}`, background: COLORS.sidebar, padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: COLORS.primary, animation: caseStreaming ? "pulse 1.2s ease-in-out infinite" : "none" }} />
                  <span style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 600 }}>Ask about this case</span>
                </div>
              </div>

              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
                <div ref={caseMessagesScrollRef} style={{ flex: 1, overflowY: "auto", padding: "14px 14px 120px" }}>
                  {caseMessages.length === 0 ? (
                    <div>
                      <div style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 8 }}>Suggested questions</div>
                      {fullscreenCase.discussion_starters.map((starter) => (
                        <button
                          key={starter}
                          onClick={async () => {
                            setCaseInput(starter);
                            await sendCaseMessage(starter);
                          }}
                          style={{ width: "100%", background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 8, cursor: "pointer", fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.5, textAlign: "left" }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = COLORS.primary;
                            e.currentTarget.style.color = COLORS.textPrimary;
                            e.currentTarget.style.background = COLORS.surfaceRaised;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = COLORS.border;
                            e.currentTarget.style.color = COLORS.textSecondary;
                            e.currentTarget.style.background = COLORS.surface;
                          }}
                        >
                          {starter}
                        </button>
                      ))}
                      <div style={{ color: COLORS.textMuted, fontSize: 11, textAlign: "center", marginTop: 12 }}>— or ask anything —</div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      {caseMessages.map((m, idx) => {
                        const isStreamingAssistant = caseStreaming && m.role === "assistant" && idx === caseMessages.length - 1 && !caseCompletedIds.has(m.id);
                        if (m.role === "user") {
                          return (
                            <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                              <div style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 4 }}>You · {timeLabel(m.timestamp)}</div>
                              <div style={{ maxWidth: "85%", background: COLORS.primary, color: "#fff", borderRadius: "16px 16px 4px 16px", padding: "10px 14px", fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{m.content}</div>
                            </div>
                          );
                        }

                        return (
                          <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                            <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4 }}>Case AI · {timeLabel(m.timestamp)}</div>
                            <div style={{ maxWidth: "92%", background: COLORS.surfaceRaised, color: COLORS.textPrimary, borderRadius: "16px 16px 16px 4px", padding: "12px 14px", border: `1px solid ${COLORS.border}`, fontSize: 13.5, lineHeight: 1.6 }}>
                              {isStreamingAssistant ? (
                                <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.content}</div>
                              ) : (
                                <MessageMarkdown content={m.content} isStreaming={false} />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div ref={caseMessagesEndRef} />
                </div>

                <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, borderTop: `1px solid ${COLORS.border}`, background: COLORS.bg, padding: isMobile ? "8px 10px calc(8px + env(safe-area-inset-bottom))" : "8px 10px" }}>
                  <div style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "6px 10px", display: "flex", alignItems: "center", gap: 8 }}>
                    <textarea
                      ref={caseTextareaRef}
                      value={caseInput}
                      onChange={(e) => setCaseInput(e.target.value)}
                      onKeyDown={handleCaseInputKeyDown}
                      placeholder="Ask anything about this case..."
                      style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: COLORS.textPrimary, fontSize: 12.5, fontFamily: "Manrope, sans-serif", resize: "none", minHeight: 18, maxHeight: 90, lineHeight: 1.45 }}
                    />

                    {caseStreaming ? (
                      <button
                        onClick={() => {
                          caseAbortController?.abort();
                          setCaseStreaming(false);
                          setCaseAbortController(null);
                        }}
                        style={{ width: 34, height: 34, border: "none", borderRadius: 999, background: COLORS.error, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                      >
                        <Icon name="stop" size={18} color="#fff" />
                      </button>
                    ) : (
                      <button
                        onClick={async () => sendCaseMessage()}
                        disabled={!caseInput.trim()}
                        style={{ width: 30, height: 30, border: "none", borderRadius: 999, background: caseInput.trim() ? COLORS.primary : COLORS.border, color: caseInput.trim() ? "#fff" : COLORS.textMuted, display: "flex", alignItems: "center", justifyContent: "center", cursor: caseInput.trim() ? "pointer" : "not-allowed" }}
                      >
                        <Icon name="arrow_upward" size={18} color={caseInput.trim() ? "#fff" : COLORS.textMuted} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

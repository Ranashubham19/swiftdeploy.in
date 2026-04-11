"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";

type Feature = {
  icon: string;
  title: string;
  description: string;
  tag?: string;
  hot?: boolean;
};

type PricingCurrency = "usd" | "inr";
type PricingPeriod = "mo" | "yr";
type PricingPlanKey = "free" | "starter" | "pro";

type PricingPlan = {
  id: PricingPlanKey;
  name: string;
  featured?: boolean;
  buttonLabel: string;
  buttonClassName: string;
  features: ReadonlyArray<{
    label: string;
    enabled: boolean;
  }>;
};

const howItWorks = [
  {
    title: "Sign up with Google",
    description:
      "Create your account in 30 seconds using your Google login. No credit card required on the free plan.",
  },
  {
    title: "Connect WhatsApp",
    description:
      "Scan one WhatsApp QR code and your personal ClawCloud agent is ready inside the chat app you already use.",
  },
  {
    title: "Pick WhatsApp tasks",
    description:
      "Choose WhatsApp reminders, contact memory, chat summaries, and media understanding. Simple toggles, no complex setup.",
  },
  {
    title: "Chat naturally",
    description:
      "Ask questions, read chats, send messages, analyze media, or set reminders directly from WhatsApp when you want.",
  },
] as const;


const features: readonly Feature[] = [
  {
    icon: "\u{1F4AC}",
    title: "WhatsApp-first AI",
    description:
      "Ask coding, study, current-affairs, translation, writing, and daily-life questions directly inside WhatsApp.",
    tag: "Most used feature",
    hot: true,
  },
  {
    icon: "\u{1F465}",
    title: "Contact-safe actions",
    description:
      "Send, reply, summarize, and read messages only when you explicitly ask, with safer contact matching before delivery.",
  },
  {
    icon: "\u{1F5BC}",
    title: "Media understanding",
    description:
      "Send photos, PDFs, recordings, and documents for one-box WhatsApp-style explanations, extraction, and summaries.",
  },
  {
    icon: "\u{1F514}",
    title: "Smart Reminders",
    description:
      'Tell it anything: "Remind me to follow up with Rahul on Friday 5pm." It just works, delivered to you on WhatsApp.',
  },
  {
    icon: "\u{1F50D}",
    title: "Latest-source answers",
    description:
      "For current topics, ClawCloud routes through live evidence checks instead of pretending stale model memory is enough.",
  },
  {
    icon: "\u26A1",
    title: "Conversation memory",
    description:
      "Follow-up questions stay attached to the previous topic, and WhatsApp contact tasks stay separated from general Q&A.",
  },
] as const;

const pricingPlans: readonly PricingPlan[] = [
  {
    id: "free",
    name: "Free",
    featured: false,
    buttonLabel: "Get started free",
    buttonClassName: "plan-btn",
    features: [
      { label: "WhatsApp agent setup", enabled: true },
      { label: "3 active WhatsApp tasks", enabled: true },
      { label: "10 AI runs per day", enabled: true },
      { label: "Chat, reminders, and media Q&A", enabled: true },
      { label: "Advanced task capacity", enabled: false },
      { label: "Priority support", enabled: false },
    ],
  },
  {
    id: "starter",
    name: "Starter",
    featured: true,
    buttonLabel: "Start free trial \u2192",
    buttonClassName: "plan-btn primary",
    features: [
      { label: "WhatsApp agent setup", enabled: true },
      { label: "10 active WhatsApp tasks", enabled: true },
      { label: "100 AI runs per day", enabled: true },
      { label: "Contact memory and chat summaries", enabled: true },
      { label: "Media, PDF, and voice understanding", enabled: true },
      { label: "Priority support", enabled: false },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    featured: false,
    buttonLabel: "Get Pro \u2192",
    buttonClassName: "plan-btn",
    features: [
      { label: "Unlimited WhatsApp tasks", enabled: true },
      { label: "Unlimited AI runs", enabled: true },
      { label: "Advanced contact and history controls", enabled: true },
      { label: "Deep answers and stronger live-source checks", enabled: true },
      { label: "Priority support", enabled: true },
      { label: "Analytics dashboard", enabled: true },
    ],
  },
] as const;

const testimonials = [
  {
    initials: "RK",
    avatarStyle: { background: "rgba(127,119,221,0.18)", color: "#AFA9EC" },
    text:
      '"I ask everything on WhatsApp now - coding questions, contact summaries, reminders, and quick translations. It feels like a serious assistant, not another app to open."',
    name: "Rahul Kumar",
    role: "Student, Delhi",
  },
  {
    initials: "PS",
    avatarStyle: { background: "rgba(29,158,117,0.18)", color: "#5DCAA5" },
    text:
      '"I was sceptical but the 2-minute setup is genuinely real. My whole team is now on it. It\'s like having a secretary that works 24/7 on WhatsApp."',
    name: "Priya Sharma",
    role: "Founder, Bengaluru",
  },
  {
    initials: "AM",
    avatarStyle: { background: "rgba(216,90,48,0.18)", color: "#F0997B" },
    text:
      '"The contact safety matters most for me. It asks when a name is unclear and only sends when I explicitly tell it to send. That makes it feel trustworthy."',
    name: "Arjun Mehta",
    role: "Founder, Mumbai",
  },
] as const;

const faqs = [
  {
    question: "Is my WhatsApp data safe?",
    answer:
      "ClawCloud uses your linked WhatsApp session only to power the tasks you request. It is designed to avoid autonomous outbound messages, keep contact actions explicit, and let you disconnect the session when needed.",
  },
  {
    question: "Do I need to install anything?",
    answer:
      "Nothing extra. ClawCloud runs in the cloud. You sign in, scan a WhatsApp QR code, and then use the assistant from WhatsApp.",
  },
  {
    question: "Does it work with other apps too?",
    answer:
      "The current product experience is focused on WhatsApp only. Pricing, setup, and dashboard flows are now built around WhatsApp tasks.",
  },
  {
    question: "What AI model powers ClawCloud?",
    answer:
      "ClawCloud is built on top of OpenClaw, which uses state-of-the-art large language models. We select the best model for each task to balance speed, accuracy, and cost - you never have to think about this.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes, cancel any time from your dashboard with a single click. No questions asked, no hidden fees, no cancellation penalties. Your free tier access continues forever even after cancelling a paid plan.",
  },
  {
    question: "Will it send WhatsApp messages without my approval?",
    answer:
      "No. ClawCloud only sends or replies when you explicitly give a send/reply instruction. General questions, drafts, translations, and casual chat stay in your own chat unless you command a contact action.",
  },
] as const;

const pricingValues: Record<PricingPlanKey, Record<PricingCurrency, Record<PricingPeriod, number>>> = {
  free: {
    usd: { mo: 0, yr: 0 },
    inr: { mo: 0, yr: 0 },
  },
  starter: {
    usd: { mo: 29, yr: 278 },
    inr: { mo: 799, yr: 7670 },
  },
  pro: {
    usd: { mo: 79, yr: 758 },
    inr: { mo: 2499, yr: 23990 },
  },
};

const pricingSymbols: Record<PricingCurrency, string> = {
  usd: "$",
  inr: "\u20B9",
};

function formatPricingValue(value: number, currency: PricingCurrency) {
  return value.toLocaleString(currency === "inr" ? "en-IN" : "en-US");
}

export function ClawCloudLanding() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [pricingCurrency, setPricingCurrency] = useState<PricingCurrency>("usd");
  const [annualBilling, setAnnualBilling] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 8);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>(".reveal");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 },
    );

    elements.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
    };
  }, []);

  const closeMenu = () => setMenuOpen(false);

  const scrollToStart = () => {
    closeMenu();
    window.location.href = "/auth";
  };

  const handleWaitlistSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!waitlistEmail.trim()) {
      return;
    }

    setWaitlistSubmitted(true);
    setWaitlistEmail("");
  };

  return (
    <>
      <div className="orb orb1" />
      <div className="orb orb2" />
      <div className="orb orb3" />

      <nav id="navbar" className={scrolled ? "scrolled" : undefined}>
        <a href="#top" className="logo" onClick={closeMenu}>
          <div className="logo-icon">AI</div>
          Claw<em>Cloud</em>
        </a>

        <ul className="nav-links">
          <li>
            <a href="#how">How it works</a>
          </li>
          <li>
            <a href="#features">Features</a>
          </li>
          <li>
            <a href="#pricing">Pricing</a>
          </li>
          <li>
            <a href="#faq">FAQ</a>
          </li>
          <li>
            <a href="/auth" className="nav-cta">
              Get started free &rarr;
            </a>
          </li>
        </ul>

        <button
          className={`hamburger${menuOpen ? " open" : ""}`}
          id="hamburger"
          aria-label="Menu"
          aria-expanded={menuOpen}
          type="button"
          onClick={() => setMenuOpen((current) => !current)}
        >
          <span />
          <span />
          <span />
        </button>
      </nav>

      <div className={`mobile-nav${menuOpen ? " open" : ""}`} id="mobileNav">
        <a href="#how" onClick={closeMenu}>
          How it works
        </a>
        <a href="#features" onClick={closeMenu}>
          Features
        </a>
        <a href="#pricing" onClick={closeMenu}>
          Pricing
        </a>
        <a href="#faq" onClick={closeMenu}>
          FAQ
        </a>
        <a href="/auth" className="mob-cta" onClick={closeMenu}>
          Get started free &rarr;
        </a>
      </div>

      <section className="hero" id="top">
        <div className="hero-badge">
          <span className="dot" />
          Powered by OpenClaw AI &nbsp;&middot;&nbsp; Now in beta
        </div>

        <h1>
          Your personal AI
          <span className="block accent">lives on WhatsApp.</span>
        </h1>

        <p className="hero-sub">
          Answers questions, manages WhatsApp contacts safely, reads chat history when you ask, analyzes media,
          and sets reminders from the chat app already on your phone. No extra app. No code. Just type.
        </p>

        <div className="hero-btns">
          <a href="/auth" className="btn-red" onClick={closeMenu}>
            Start free - 2 min setup &rarr;
          </a>
          <a href="#how" className="btn-ghost" onClick={closeMenu}>
            See how it works
          </a>
        </div>

        <div className="trust-row">
          <span className="trust-pill">
            <span className="icon">{"\u{1F512}"}</span> Encrypted in transit
          </span>
          <span className="trust-divider" />
          <span className="trust-pill">
            <span className="icon">{"\u26A1"}</span> 2-minute setup
          </span>
          <span className="trust-divider" />
          <span className="trust-pill">
            <span className="icon">{"\u{1F193}"}</span> Free to start
          </span>
          <span className="trust-divider" />
          <span className="trust-pill">
            <span className="icon">{"\u{1F1EE}\u{1F1F3}"}</span> Built for India
          </span>
        </div>

      </section>

      <div className="stats-bar">
        <div className="stat-item">
          <div className="stat-num">
            2<em>min</em>
          </div>
          <div className="stat-label">Average setup time</div>
        </div>
        <div className="stat-item">
          <div className="stat-num">
            1.5<em>hr</em>
          </div>
          <div className="stat-label">Saved per day per user</div>
        </div>
        <div className="stat-item">
          <div className="stat-num">0</div>
          <div className="stat-label">Lines of code needed</div>
        </div>
        <div className="stat-item">
          <div className="stat-num">
            12<em>k+</em>
          </div>
          <div className="stat-label">Beta waitlist</div>
        </div>
      </div>

      <section id="how">
        <div className="sec-inner">
          <div className="sec-head reveal">
            <div className="sec-label">How it works</div>
            <div className="sec-title">
              Live in 2 minutes.
              <br />
              No technical skills needed.
            </div>
            <div className="sec-sub">
              We handle all the servers, APIs, and configuration. You just connect and go.
            </div>
          </div>
          <div className="steps-grid">
            {howItWorks.map((step, index) => (
              <div key={step.title} className="step-card reveal">
                <div className="step-n">{String(index + 1).padStart(2, "0")}</div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>


      <section id="features">
        <div className="sec-inner">
          <div className="sec-head reveal">
            <div className="sec-label">What it can do</div>
            <div className="sec-title">
              Your AI handles
              <br />
              the boring stuff.
            </div>
            <div className="sec-sub">
              Everything happens directly in WhatsApp. No new app to open, no dashboard to check.
            </div>
          </div>
          <div className="features-grid">
            {features.map((feature) => (
              <div
                key={feature.title}
                className={`feat-card reveal${feature.hot ? " hot" : ""}`}
              >
                <span className="feat-icon">{feature.icon}</span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
                {feature.tag ? <span className="feat-tag">{feature.tag}</span> : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="pricing-sec">
        <div className="pricing-inner">
          <div className="reveal">
            <div className="sec-label">Pricing</div>
            <div className="sec-title">WhatsApp-only pricing for ClawCloud.</div>
            <div className="sec-sub" style={{ margin: "0 auto" }}>
              Start free with WhatsApp. Upgrade only when you need more tasks, more runs, or priority support.
            </div>
          </div>

          <div className="pricing-controls reveal">
            <div className="currency-toggle" role="group" aria-label="Choose pricing currency">
              <button
                type="button"
                className={`curr-btn${pricingCurrency === "usd" ? " active" : ""}`}
                aria-pressed={pricingCurrency === "usd"}
                onClick={() => setPricingCurrency("usd")}
              >
                {"\u{1F1FA}\u{1F1F8}"} USD
              </button>
              <button
                type="button"
                className={`curr-btn${pricingCurrency === "inr" ? " active" : ""}`}
                aria-pressed={pricingCurrency === "inr"}
                onClick={() => setPricingCurrency("inr")}
              >
                {"\u{1F1EE}\u{1F1F3}"} INR
              </button>
            </div>

            <div className="billing-toggle">
              <span className={`billing-lbl${annualBilling ? "" : " active"}`}>Monthly</span>
              <label className="toggle-sw" aria-label="Toggle annual billing">
                <input
                  type="checkbox"
                  checked={annualBilling}
                  onChange={(event) => setAnnualBilling(event.target.checked)}
                />
                <span className="tg-track" />
                <span className="tg-thumb" />
              </label>
              <span className={`billing-lbl${annualBilling ? " active" : ""}`}>Annual</span>
              <span className="save-pill">Save 20%</span>
            </div>
          </div>

          <div className="pricing-grid">
            {pricingPlans.map((plan) => {
              const activePeriod: PricingPeriod = annualBilling ? "yr" : "mo";
              const otherCurrency: PricingCurrency = pricingCurrency === "usd" ? "inr" : "usd";
              const activePrice = pricingValues[plan.id][pricingCurrency][activePeriod];
              const displayedPrice = annualBilling && activePrice > 0 ? Math.round(activePrice / 12) : activePrice;
              const otherMonthlyPrice = pricingValues[plan.id][otherCurrency][activePeriod];
              const monthlyBasePrice = pricingValues[plan.id][pricingCurrency].mo;
              const activeSymbol = pricingSymbols[pricingCurrency];
              const otherSymbol = pricingSymbols[otherCurrency];

              return (
                <div key={plan.id} className={`pricing-card reveal${plan.featured ? " popular" : ""}`}>
                  {plan.featured ? <div className="popular-badge">MOST POPULAR</div> : null}
                  <div className="plan-name">{plan.name}</div>
                  <div className="plan-price-block">
                    <div className="plan-price-row">
                      <span className="plan-price-sym">{activeSymbol}</span>
                      <span className="plan-price-num">{formatPricingValue(displayedPrice, pricingCurrency)}</span>
                      <span className="plan-price-per">/mo</span>
                    </div>
                    <div className="plan-price-alt">
                      {plan.id === "free" ? (
                        "Always free in any currency"
                      ) : annualBilling ? (
                        <>
                          <span className="plan-price-cross">
                            {activeSymbol}
                            {formatPricingValue(monthlyBasePrice, pricingCurrency)}/mo
                          </span>
                          {" \u2192 "}
                          {activeSymbol}
                          {formatPricingValue(activePrice, pricingCurrency)}/yr
                          {" \u00B7 Also "}
                          {otherSymbol}
                          {formatPricingValue(pricingValues[plan.id][otherCurrency].yr, otherCurrency)}/yr
                        </>
                      ) : (
                        <>
                          Also {otherSymbol}
                          {formatPricingValue(otherMonthlyPrice, otherCurrency)}/mo
                        </>
                      )}
                    </div>
                  </div>
                  <div className="plan-period">
                    {plan.id === "free"
                      ? "forever free"
                      : annualBilling
                        ? `billed ${activeSymbol}${formatPricingValue(activePrice, pricingCurrency)} annually`
                        : "billed monthly"}
                  </div>
                  <hr className="plan-divider" />
                  <ul className="plan-features">
                    {plan.features.map((feature) => (
                      <li key={feature.label} className={feature.enabled ? undefined : "no"}>
                        {feature.label}
                      </li>
                    ))}
                  </ul>
                  <button className={plan.buttonClassName} type="button" onClick={scrollToStart}>
                    {plan.buttonLabel}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="payment-badges reveal">
            <span className="payment-lead">Pay with:</span>
            <span className="pm-badge">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"
                  fill="#6356ff"
                />
              </svg>
              Stripe (USD / INR / 135+ currencies)
            </span>
            <span className="pm-badge">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M16.5 0 9 15h4.5L6 24 19.5 10.5h-6L16.5 0Z" fill="#009faa" />
              </svg>
              Razorpay (UPI · Net Banking · INR)
            </span>
            <span className="pm-badge">{"\u{1F4B3}"} Cards · {"\u{1F34E}"} Apple Pay · {"\u{1F535}"} UPI</span>
          </div>
        </div>
      </section>

      <section>
        <div className="sec-inner" style={{ paddingTop: 0 }}>
          <div className="sec-head reveal">
            <div className="sec-label">Testimonials</div>
            <div className="sec-title">Real people, real time saved.</div>
          </div>
          <div className="testi-grid">
            {testimonials.map((testimonial) => (
              <div key={testimonial.name} className="testi-card reveal">
                <div className="t-stars">{"\u2605\u2605\u2605\u2605\u2605"}</div>
                <p className="t-text">{testimonial.text}</p>
                <div className="t-author">
                  <div className="t-av" style={testimonial.avatarStyle}>
                    {testimonial.initials}
                  </div>
                  <div>
                    <div className="t-name">{testimonial.name}</div>
                    <div className="t-role">{testimonial.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="faq">
        <div className="faq-sec">
          <div className="faq-head reveal">
            <div className="sec-label">FAQ</div>
            <div className="sec-title">Common questions.</div>
          </div>

          {faqs.map((item, index) => {
            const isOpen = openFaqIndex === index;
            const bodyId = `faq-answer-${index}`;

            return (
              <div key={item.question} className={`faq-item${isOpen ? " open" : ""}`}>
                <button
                  className="faq-q"
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={bodyId}
                  onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                >
                  {item.question}
                  <span className="faq-icon">+</span>
                </button>
                <div id={bodyId} className="faq-body">
                  <div className="faq-body-inner">{item.answer}</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="cta-sec" id="start">
        <div className="cta-box reveal">
          <h2>
            Your AI is waiting.
            <br />
            Start in 2 minutes.
          </h2>
          <p>
            Join 12,000+ people who already have their personal AI agent running on WhatsApp. Free to start -
            no credit card needed.
          </p>

          {waitlistSubmitted ? (
            <div className="cta-success" id="ctaSuccess" style={{ display: "inline-flex" }}>
              {"\u{1F389}"} &nbsp;You&apos;re on the list! We&apos;ll reach out within 24 hours
            </div>
          ) : (
            <form className="cta-form" id="ctaForm" onSubmit={handleWaitlistSubmit}>
              <input
                type="email"
                id="ctaEmail"
                className="cta-input"
                placeholder="Enter your email address"
                autoComplete="email"
                value={waitlistEmail}
                onChange={(event) => setWaitlistEmail(event.target.value)}
                required
              />
              <button className="btn-red" type="submit">
                Get early access &rarr;
              </button>
            </form>
          )}
        </div>
      </section>

      <footer>
        <a href="#top" className="logo" onClick={closeMenu}>
          <div className="logo-icon">AI</div>
          Claw<em>Cloud</em>
        </a>
        <div className="footer-links">
          <a href="#top">Home</a>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
          <a href="/auth">Get started</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </div>
        <div className="footer-copy">&copy; 2026 ClawCloud. All rights reserved.</div>
      </footer>
    </>
  );
}

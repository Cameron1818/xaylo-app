// Single source of truth for plan names, prices and features shown in the public guide and Billing.
// Provider-neutral: the SwanPay checkout (to be implemented) should sell these prices. See docs/mvp-issues.md I-17.
export type Plan = {
  id: 'insights' | 'autopilot';
  name: string;
  available: boolean;
  currency: 'GBP';
  monthly: number;
  yearly: number;
  tagline: string;
  features: string[];
};

export const PLANS: readonly Plan[] = [
  {
    id: 'insights', name: 'Xaylo Insights', available: true, currency: 'GBP', monthly: 49, yearly: 490,
    tagline: 'One focused, evidence-based action every week.',
    features: [
      'Weekly AI report with one clear action',
      'Results of your last change before each new report',
      'Website traffic, visitor routes and conversion analysis',
      'Google Ads conversions and clicks (read-only)',
      'Xaylo Journeys personalisation',
      'Optional HighLevel CRM insight',
      'Connect your AI assistant through MCP'
    ]
  },
  {
    id: 'autopilot', name: 'Xaylo Autopilot', available: false, currency: 'GBP', monthly: 149, yearly: 1490,
    tagline: 'Smart, automated growth that keeps improving your ROI.',
    features: [
      'Everything in Insights',
      'Daily smart summaries and daily AI reports',
      'Automatic ROI improvements',
      'Automated strategy that adapts as results come in',
      'Custom AI journeys that evolve from your Xaylo Journeys',
      'Smart alerts when performance shifts'
    ]
  }
];

const symbols: Record<Plan['currency'], string> = { GBP: '£' };
export const formatPrice = (plan: Plan, interval: 'monthly' | 'yearly') =>
  `${symbols[plan.currency]}${plan[interval].toLocaleString('en-GB')}${interval === 'monthly' ? '/month' : '/year'}`;

const escape = (value: string) => value.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
export function planCardsHtml(plans: readonly Plan[] = PLANS) {
  return plans.map(plan => `<article class="plan-card${plan.available ? '' : ' is-unavailable'}" aria-disabled="${!plan.available}">`
    + `${plan.available ? '' : '<span class="plan-status">Currently unavailable</span>'}`
    + `<h3>${escape(plan.name)}</h3><p class="plan-price"><strong>${escape(formatPrice(plan, 'monthly'))}</strong> <span>or ${escape(formatPrice(plan, 'yearly'))}</span></p>`
    + `<p class="plan-tagline">${escape(plan.tagline)}</p><ul class="checklist">${plan.features.map(feature => `<li>${escape(feature)}</li>`).join('')}</ul>`
    + (plan.available ? '<a class="button" href="/app">Start your free trial <span aria-hidden="true">↗</span></a>' : '<span class="button is-disabled" aria-disabled="true">Coming soon</span>')
    + '</article>').join('');
}

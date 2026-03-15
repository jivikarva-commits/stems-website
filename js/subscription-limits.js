/**
 * Per-Feature Subscription Limit Manager
 *
 * Enforces independent usage limits for each feature based on user plan.
 * Each feature has its own counter — reaching one limit does NOT affect others.
 *
 * Daily counters auto-reset every 24 hours.
 * revision_notes_total is a lifetime counter and is never auto-reset.
 *
 * Storage key: "stems_usage_data" in localStorage
 *
 * Integration with server-side APIs:
 *   Each API endpoint should call checkLimit(feature) before processing.
 *   Example: /api/learn-chat → checkLimit('ai_chat')
 *            /api/mock-test  → checkLimit('mock_tests')
 */

var SubscriptionLimits = (function () {
  'use strict';

  var STORAGE_KEY = 'stems_usage_data';

  // Plan definitions with per-feature limits
  var PLANS = {
    free: {
      name: 'Free',
      limits: {
        ai_chat:        15,  // per day
        mock_tests:      5,  // per day
        drafts:          5,  // per day
        case_law:        5,  // per day
        study_plans:     3,  // per day
        revision_notes: 10   // total (lifetime)
      }
    },
    pro: {
      name: 'Pro',
      limits: {
        ai_chat:        50,
        mock_tests:     20,
        drafts:         20,
        case_law:       20,
        study_plans:    10,
        revision_notes: 50
      }
    },
    premium: {
      name: 'Premium',
      limits: {
        ai_chat:       -1,  // -1 = unlimited
        mock_tests:    -1,
        drafts:        -1,
        case_law:      -1,
        study_plans:   -1,
        revision_notes: -1
      }
    }
  };

  // Features that reset daily (revision_notes is excluded)
  var DAILY_FEATURES = ['ai_chat', 'mock_tests', 'drafts', 'case_law', 'study_plans'];

  // Human-readable feature labels used in limit-reached messages
  var FEATURE_LABELS = {
    ai_chat:        'AI questions',
    mock_tests:     'mock tests',
    drafts:         'draft evaluations',
    case_law:       'case law saves',
    study_plans:    'study plans',
    revision_notes: 'saved revision notes'
  };

  // ---------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------

  /** Return today's date as YYYY-MM-DD string */
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /** Read stored data from localStorage */
  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      // corrupted data – start fresh
    }
    return null;
  }

  /** Persist data to localStorage */
  function saveData(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      // storage full or unavailable – silently fail
    }
  }

  /** Return a fresh usage object for a given plan */
  function createDefaultUsage(plan) {
    return {
      plan: plan || 'free',
      last_reset_date: todayKey(),
      ai_chat_used_today: 0,
      mock_tests_used_today: 0,
      drafts_used_today: 0,
      case_law_saved_today: 0,
      study_plans_created_today: 0,
      revision_notes_total: 0
    };
  }

  /** Map feature name to the stored counter field */
  function usageField(feature) {
    var map = {
      ai_chat:        'ai_chat_used_today',
      mock_tests:     'mock_tests_used_today',
      drafts:         'drafts_used_today',
      case_law:       'case_law_saved_today',
      study_plans:    'study_plans_created_today',
      revision_notes: 'revision_notes_total'
    };
    return map[feature] || null;
  }

  /**
   * Load usage data, auto-resetting daily counters if the day changed.
   * Returns the (possibly reset) data object.
   */
  function getUsageData() {
    var data = loadData();
    if (!data) {
      data = createDefaultUsage('free');
      saveData(data);
      return data;
    }

    // Auto-reset daily counters when the day changes
    if (data.last_reset_date !== todayKey()) {
      DAILY_FEATURES.forEach(function (feature) {
        var field = usageField(feature);
        if (field) {
          data[field] = 0;
        }
      });
      data.last_reset_date = todayKey();
      saveData(data);
    }

    return data;
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  /**
   * Initialise or re-initialise the usage tracker for a plan.
   * @param {string} plan - 'free' | 'pro' | 'premium'
   */
  function init(plan) {
    var validPlan = PLANS[plan] ? plan : 'free';
    var data = loadData();

    if (!data) {
      data = createDefaultUsage(validPlan);
    } else {
      data.plan = validPlan;
      // Reset daily counters on re-init
      if (data.last_reset_date !== todayKey()) {
        DAILY_FEATURES.forEach(function (feature) {
          var field = usageField(feature);
          if (field) {
            data[field] = 0;
          }
        });
        data.last_reset_date = todayKey();
      }
    }
    saveData(data);
    return data;
  }

  /**
   * Check whether the user can still use a given feature.
   * @param {string} feature - one of: ai_chat, mock_tests, drafts, case_law, study_plans, revision_notes
   * @returns {{ allowed: boolean, used: number, limit: number, remaining: number, message: string }}
   */
  function checkLimit(feature) {
    var data = getUsageData();
    var plan = PLANS[data.plan] || PLANS.free;
    var limit = plan.limits[feature];
    var field = usageField(feature);

    if (limit === undefined || !field) {
      return { allowed: false, used: 0, limit: 0, remaining: 0,
        message: 'Unknown feature: ' + feature };
    }

    var used = data[field] || 0;

    // unlimited
    if (limit === -1) {
      return { allowed: true, used: used, limit: -1, remaining: -1, message: '' };
    }

    var remaining = Math.max(0, limit - used);
    var allowed = used < limit;

    var message = '';
    if (!allowed) {
      var period = (feature === 'revision_notes') ? '' : ' daily';
      message = 'You have reached your' + period + ' limit of ' + limit + ' ' +
        FEATURE_LABELS[feature] + '. Upgrade your plan to continue.';
    }

    return { allowed: allowed, used: used, limit: limit, remaining: remaining, message: message };
  }

  /**
   * Increment the usage counter for a feature (call AFTER a successful action).
   * Returns the updated check result (same shape as checkLimit).
   * @param {string} feature
   * @returns {{ allowed: boolean, used: number, limit: number, remaining: number, message: string }}
   */
  function recordUsage(feature) {
    var data = getUsageData();
    var field = usageField(feature);

    if (!field) {
      return { allowed: false, used: 0, limit: 0, remaining: 0,
        message: 'Unknown feature: ' + feature };
    }

    data[field] = (data[field] || 0) + 1;
    saveData(data);

    return checkLimit(feature);
  }

  /**
   * Get usage summary for all features.
   * @returns {Object} keyed by feature name, each value is checkLimit result
   */
  function getUsageSummary() {
    var summary = {};
    var features = Object.keys(FEATURE_LABELS);
    features.forEach(function (f) {
      summary[f] = checkLimit(f);
    });
    return summary;
  }

  /**
   * Get the current plan name.
   * @returns {string}
   */
  function getCurrentPlan() {
    var data = getUsageData();
    return data.plan;
  }

  /**
   * Change the user's plan. Preserves current usage counters.
   * @param {string} plan - 'free' | 'pro' | 'premium'
   */
  function changePlan(plan) {
    if (!PLANS[plan]) return;
    var data = getUsageData();
    data.plan = plan;
    saveData(data);
  }

  /**
   * Manually reset daily counters (does NOT reset revision_notes_total).
   */
  function resetDailyCounters() {
    var data = getUsageData();
    DAILY_FEATURES.forEach(function (feature) {
      var field = usageField(feature);
      if (field) {
        data[field] = 0;
      }
    });
    data.last_reset_date = todayKey();
    saveData(data);
  }

  /**
   * Clear all stored data (full reset).
   */
  function clearAll() {
    localStorage.removeItem(STORAGE_KEY);
  }

  /**
   * Return the raw stored data (for debugging).
   */
  function getRawData() {
    return getUsageData();
  }

  /**
   * Return the plan definitions (for external inspection).
   */
  function getPlanDefinitions() {
    return PLANS;
  }

  // Expose public API
  return {
    init: init,
    checkLimit: checkLimit,
    recordUsage: recordUsage,
    getUsageSummary: getUsageSummary,
    getCurrentPlan: getCurrentPlan,
    changePlan: changePlan,
    resetDailyCounters: resetDailyCounters,
    clearAll: clearAll,
    getRawData: getRawData,
    getPlanDefinitions: getPlanDefinitions
  };
})();

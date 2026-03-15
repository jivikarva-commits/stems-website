/**
 * API Helpers — Per-Endpoint Usage Validation
 *
 * Each simulated API endpoint checks ONLY its own feature limit
 * via SubscriptionLimits.checkLimit(feature) before processing.
 *
 * This ensures that reaching the AI Chat limit does NOT affect
 * Mock Tests, Drafts, Case Law, Study Plans, or Revision Notes.
 *
 * In a real server-side implementation, these checks would live in
 * your backend route handlers or middleware. The pattern is the same:
 *   1. checkLimit(feature) — if not allowed, return limit-reached error.
 *   2. Process the request.
 *   3. recordUsage(feature) — increment the counter on success.
 */

var ApiHelpers = (function () {
  'use strict';

  /**
   * Generic wrapper: check limit → run action → record usage.
   * @param {string} feature - SubscriptionLimits feature key
   * @param {Function} action  - callback to run when allowed, receives (resolve, reject)
   * @returns {Promise<*>}
   */
  function withLimitCheck(feature, action) {
    return new Promise(function (resolve, reject) {
      var check = SubscriptionLimits.checkLimit(feature);

      if (!check.allowed) {
        reject({ limitReached: true, feature: feature, message: check.message });
        return;
      }

      // Execute the action; on success record usage automatically
      try {
        var result = action();

        // Handle both sync and async actions
        if (result && typeof result.then === 'function') {
          result.then(function (val) {
            SubscriptionLimits.recordUsage(feature);
            resolve(val);
          }).catch(function (err) {
            reject(err);
          });
        } else {
          SubscriptionLimits.recordUsage(feature);
          resolve(result);
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  // ---------------------------------------------------------------
  // Endpoint handlers — each checks only its own feature
  // ---------------------------------------------------------------

  /**
   * POST /api/learn-chat → check ai_chat limit
   * @param {string} question - the user's question
   * @returns {Promise<{ answer: string }>}
   */
  function learnChat(question) {
    return withLimitCheck('ai_chat', function () {
      // Placeholder: replace with actual AI chat API call
      return { answer: 'AI response for: ' + question };
    });
  }

  /**
   * POST /api/mock-test → check mock_tests limit
   * @param {Object} options - test configuration
   * @returns {Promise<{ testId: string }>}
   */
  function startMockTest(options) {
    return withLimitCheck('mock_tests', function () {
      return { testId: 'test_' + Date.now() };
    });
  }

  /**
   * POST /api/draft-evaluation → check drafts limit
   * @param {string} draftContent - the draft text to evaluate
   * @returns {Promise<{ evaluation: string }>}
   */
  function evaluateDraft(draftContent) {
    return withLimitCheck('drafts', function () {
      return { evaluation: 'Draft evaluation result for submitted content.' };
    });
  }

  /**
   * POST /api/case-law-save → check case_law limit
   * @param {Object} caseData - case law data to save
   * @returns {Promise<{ saved: boolean }>}
   */
  function saveCaseLaw(caseData) {
    return withLimitCheck('case_law', function () {
      return { saved: true };
    });
  }

  /**
   * POST /api/study-plan → check study_plans limit
   * @param {Object} planData - study plan configuration
   * @returns {Promise<{ planId: string }>}
   */
  function createStudyPlan(planData) {
    return withLimitCheck('study_plans', function () {
      return { planId: 'plan_' + Date.now() };
    });
  }

  /**
   * POST /api/revision-note → check revision_notes limit
   * @param {Object} noteData - note content
   * @returns {Promise<{ noteId: string }>}
   */
  function saveRevisionNote(noteData) {
    return withLimitCheck('revision_notes', function () {
      return { noteId: 'note_' + Date.now() };
    });
  }

  return {
    withLimitCheck: withLimitCheck,
    learnChat: learnChat,
    startMockTest: startMockTest,
    evaluateDraft: evaluateDraft,
    saveCaseLaw: saveCaseLaw,
    createStudyPlan: createStudyPlan,
    saveRevisionNote: saveRevisionNote
  };
})();

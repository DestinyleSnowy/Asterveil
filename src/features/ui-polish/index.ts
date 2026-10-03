import type { FeatureModule } from '../../core/module';
import { enhanceAccountTables } from '../../site/account-tables';
import { appearancePage } from '../../site/appearance';
import { enhanceContestReview } from '../../site/contest-review';
import { enhanceLogin } from '../../site/login';
import { enhancePlans } from '../../site/plans';
import { enhanceProblemSource } from '../../site/problem-source';
import { enhanceProblemTitle } from '../../site/problem-title';
import { enhanceRankingFilters } from '../../site/ranking-filters';
import { enhanceSubmissionCode } from '../../site/submission-code';

export default {
  mount({ scope, url }) {
    const page = appearancePage(url);
    if (page === 'login') return enhanceLogin(scope);
    if (page === 'chat') {
      return import('../../site/chat-markdown').then(({ enhanceChatMarkdown }) => {
        if (!scope.signal.aborted) enhanceChatMarkdown(scope);
      });
    }
    if (page === 'contest') return enhanceContestReview(scope, url);
    if (page === 'submission') enhanceSubmissionCode(scope);
    if (page === 'problem') {
      enhanceProblemSource(scope, url);
      enhanceProblemTitle(scope);
    }
    if (page === 'plans') enhancePlans(scope);
    if (page === 'account-rankings') enhanceRankingFilters(scope, url);
    if (page && ['account', 'account-rankings', 'account-data', 'account-schedule'].includes(page))
      enhanceAccountTables(scope);
  },
} satisfies FeatureModule;

import {ApolloError, gql, useQuery} from '@apollo/client';
import {
  Alert,
  Box,
  Colors,
  CursorHistoryControls,
  NonIdealState,
  Page,
  Tag,
  tokenToString,
} from '@dagster-io/ui';
import partition from 'lodash/partition';
import * as React from 'react';
import {Link} from 'react-router-dom';

import {PYTHON_ERROR_FRAGMENT} from '../app/PythonErrorFragment';
import {FIFTEEN_SECONDS, useQueryRefreshAtInterval} from '../app/QueryRefresh';
import {useTrackPageView} from '../app/analytics';
import {InstancePageContext} from '../instance/InstancePageContext';
import {useCanSeeConfig} from '../instance/useCanSeeConfig';
import {Loading} from '../ui/Loading';
import {StickyTableContainer} from '../ui/StickyTableContainer';

import {useSelectedRunsTab} from './RunListTabs';
import {RunTable, RUN_TABLE_RUN_FRAGMENT} from './RunTable';
import {RunsQueryRefetchContext} from './RunUtils';
import {
  RunFilterTokenType,
  RunsFilterInput,
  runsFilterForSearchTokens,
  useQueryPersistedRunFilters,
  RunFilterToken,
} from './RunsFilterInput';
import {RunsPageHeader} from './RunsPageHeader';
import {
  QueueDaemonStatusQuery,
  QueueDaemonStatusQueryVariables,
  RunsRootQuery,
  RunsRootQueryVariables,
} from './types/RunsRoot.types';
import {useCursorPaginatedQuery} from './useCursorPaginatedQuery';

const PAGE_SIZE = 25;

export const RunsRoot = () => {
  useTrackPageView();

  const [filterTokens, setFilterTokens] = useQueryPersistedRunFilters();
  const filter = runsFilterForSearchTokens(filterTokens);
  const canSeeConfig = useCanSeeConfig();

  const {queryResult, paginationProps} = useCursorPaginatedQuery<
    RunsRootQuery,
    RunsRootQueryVariables
  >({
    nextCursorForResult: (runs) => {
      if (runs.pipelineRunsOrError.__typename !== 'Runs') {
        return undefined;
      }
      return runs.pipelineRunsOrError.results[PAGE_SIZE - 1]?.id;
    },
    getResultArray: (data) => {
      if (!data || data.pipelineRunsOrError.__typename !== 'Runs') {
        return [];
      }
      return data.pipelineRunsOrError.results;
    },
    variables: {
      filter,
    },
    query: RUNS_ROOT_QUERY,
    pageSize: PAGE_SIZE,
  });

  const refreshState = useQueryRefreshAtInterval(queryResult, FIFTEEN_SECONDS);

  const currentTab = useSelectedRunsTab(filterTokens);
  const staticStatusTags = currentTab !== 'all';
  const [statusTokens, nonStatusTokens] = partition(
    filterTokens,
    (token) => token.token === 'status',
  );

  const setFilterTokensWithStatus = React.useCallback(
    (tokens: RunFilterToken[]) => {
      if (staticStatusTags) {
        setFilterTokens([...statusTokens, ...tokens]);
      } else {
        setFilterTokens(tokens);
      }
    },
    [setFilterTokens, staticStatusTags, statusTokens],
  );

  const onAddTag = React.useCallback(
    (token: RunFilterToken) => {
      const tokenAsString = tokenToString(token);
      if (!nonStatusTokens.some((token) => tokenToString(token) === tokenAsString)) {
        setFilterTokensWithStatus([...nonStatusTokens, token]);
      }
    },
    [nonStatusTokens, setFilterTokensWithStatus],
  );

  const enabledFilters = React.useMemo(() => {
    const filters: RunFilterTokenType[] = ['tag', 'snapshotId', 'id', 'job', 'pipeline'];

    if (!staticStatusTags) {
      filters.push('status');
    }

    return filters;
  }, [staticStatusTags]);

  const mutableTokens = React.useMemo(() => {
    if (staticStatusTags) {
      return filterTokens.filter((token) => token.token !== 'status');
    }
    return filterTokens;
  }, [filterTokens, staticStatusTags]);

  return (
    <Page>
      <RunsPageHeader refreshStates={[refreshState]} />
      {currentTab === 'queued' && canSeeConfig ? (
        <Box
          flex={{direction: 'column', gap: 8}}
          padding={{horizontal: 24, vertical: 16}}
          border={{side: 'bottom', width: 1, color: Colors.KeylineGray}}
        >
          <Alert
            intent="info"
            title={<Link to="/config#run_coordinator">View queue configuration</Link>}
          />
          <QueueDaemonAlert />
        </Box>
      ) : null}
      <RunsQueryRefetchContext.Provider value={{refetch: queryResult.refetch}}>
        <Loading
          queryResult={queryResult}
          allowStaleData
          renderError={(error: ApolloError) => {
            // In this case, a 400 is most likely due to invalid run filters, which are a GraphQL
            // validation error but surfaced as a 400.
            const badRequest = !!(
              error?.networkError &&
              'statusCode' in error.networkError &&
              error.networkError.statusCode === 400
            );
            return (
              <Box
                flex={{direction: 'column', gap: 32}}
                padding={{vertical: 8, left: 24, right: 12}}
              >
                <RunsFilterInput
                  tokens={mutableTokens}
                  onChange={setFilterTokensWithStatus}
                  loading={queryResult.loading}
                  enabledFilters={enabledFilters}
                />
                <NonIdealState
                  icon="warning"
                  title={badRequest ? 'Invalid run filters' : 'Unexpected error'}
                  description={
                    badRequest
                      ? 'The specified run filters are not valid. Please check the filters and try again.'
                      : 'An unexpected error occurred. Check the console for details.'
                  }
                />
              </Box>
            );
          }}
        >
          {({pipelineRunsOrError}) => {
            if (pipelineRunsOrError.__typename !== 'Runs') {
              return (
                <Box padding={{vertical: 64}}>
                  <NonIdealState
                    icon="error"
                    title="Query Error"
                    description={pipelineRunsOrError.message}
                  />
                </Box>
              );
            }

            return (
              <>
                <StickyTableContainer $top={0}>
                  <RunTable
                    runs={pipelineRunsOrError.results.slice(0, PAGE_SIZE)}
                    onAddTag={onAddTag}
                    filter={filter}
                    actionBarComponents={
                      <Box flex={{direction: 'column', gap: 8}}>
                        {currentTab !== 'all' ? (
                          <Box flex={{direction: 'row', gap: 8}}>
                            {filterTokens
                              .filter((token) => token.token === 'status')
                              .map(({token, value}) => (
                                <Tag key={`${token}:${value}`}>{`${token}:${value}`}</Tag>
                              ))}
                          </Box>
                        ) : null}
                        <RunsFilterInput
                          tokens={mutableTokens}
                          onChange={setFilterTokensWithStatus}
                          loading={queryResult.loading}
                          enabledFilters={enabledFilters}
                        />
                      </Box>
                    }
                  />
                </StickyTableContainer>
                {pipelineRunsOrError.results.length > 0 ? (
                  <div style={{marginTop: '16px'}}>
                    <CursorHistoryControls {...paginationProps} />
                  </div>
                ) : null}
              </>
            );
          }}
        </Loading>
      </RunsQueryRefetchContext.Provider>
    </Page>
  );
};

// Imported via React.lazy, which requires a default export.
// eslint-disable-next-line import/no-default-export
export default RunsRoot;

const RUNS_ROOT_QUERY = gql`
  query RunsRootQuery($limit: Int, $cursor: String, $filter: RunsFilter!) {
    pipelineRunsOrError(limit: $limit, cursor: $cursor, filter: $filter) {
      ... on Runs {
        results {
          id
          ...RunTableRunFragment
        }
      }
      ... on InvalidPipelineRunsFilterError {
        message
      }
      ...PythonErrorFragment
    }
  }

  ${RUN_TABLE_RUN_FRAGMENT}
  ${PYTHON_ERROR_FRAGMENT}
`;

const QueueDaemonAlert = () => {
  const {data} = useQuery<QueueDaemonStatusQuery, QueueDaemonStatusQueryVariables>(
    QUEUE_DAEMON_STATUS_QUERY,
  );
  const {pageTitle} = React.useContext(InstancePageContext);
  const status = data?.instance.daemonHealth.daemonStatus;
  if (status?.required && !status?.healthy) {
    return (
      <Alert
        intent="warning"
        title="The queued run coordinator is not healthy."
        description={
          <div>
            View <Link to="/health">{pageTitle}</Link> for details.
          </div>
        }
      />
    );
  }
  return null;
};

const QUEUE_DAEMON_STATUS_QUERY = gql`
  query QueueDaemonStatusQuery {
    instance {
      id
      daemonHealth {
        id
        daemonStatus(daemonType: "QUEUED_RUN_COORDINATOR") {
          id
          daemonType
          healthy
          required
        }
      }
    }
  }
`;

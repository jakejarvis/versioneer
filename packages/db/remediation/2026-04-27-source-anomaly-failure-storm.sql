-- Source anomalies are degraded-trust observations, not retryable operational failures.
-- Run the report query first, then run the two remediation updates after the app fix is deployed.

-- Report open operational failures versus source anomalies by anomaly kind.
select
  case
    when job_type = 'source-anomaly' then substr(job_key, 1, instr(job_key || ':', ':') - 1)
    else job_type
  end as bucket,
  job_type,
  count(*) as row_count,
  sum(retry_count) as retry_count_total,
  max(retry_count) as max_retry_count
from job_failures
where status = 'open'
group by bucket, job_type
order by row_count desc;

-- Backfill active legacy source-anomaly rows that predate dedupe_key.
update job_failures
set dedupe_key = json_array('source-anomaly', related_id, job_key)
where
  job_type = 'source-anomaly'
  and status in ('open', 'retrying')
  and dedupe_key is null
  and related_id is not null
  and job_key is not null
  and not exists (
    select 1
    from job_failures as existing
    where
      existing.id <> job_failures.id
      and existing.status in ('open', 'retrying')
      and existing.dedupe_key = json_array(
        'source-anomaly',
        job_failures.related_id,
        job_failures.job_key
      )
  )
  and not exists (
    select 1
    from job_failures as duplicate_legacy
    where
      duplicate_legacy.id <> job_failures.id
      and duplicate_legacy.status in ('open', 'retrying')
      and duplicate_legacy.job_type = 'source-anomaly'
      and duplicate_legacy.related_id = job_failures.related_id
      and duplicate_legacy.job_key = job_failures.job_key
      and duplicate_legacy.dedupe_key is null
  );

-- Reset source-anomaly retry counts. These rows represent observations, not retry attempts.
update job_failures
set retry_count = 0
where job_type = 'source-anomaly' and status in ('open', 'retrying') and retry_count <> 0;

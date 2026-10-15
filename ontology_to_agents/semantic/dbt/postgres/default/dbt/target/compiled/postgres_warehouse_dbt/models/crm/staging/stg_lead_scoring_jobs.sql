

with ranked as (
    select
        cast(id as text)                as lead_scoring_job_id,
        cast(organization_id as text)   as organization_id,
        cast(contact_id as text)        as contact_id,
        cast(status as text)            as status,
        score,
        cast(grade as text)             as grade,
        cast(band as text)              as band,
        fit_score,
        intent_score,
        cast(rationale as text)         as rationale,
        cast(next_best_action as text)  as next_best_action,
        completed_at,
        created_at,
        updated_at,
        row_number() over (
            partition by organization_id, contact_id
            order by completed_at desc nulls last, created_at desc
        ) as rn
    from "worktual_bigint"."crm"."lead_scoring_jobs"
    where cast(status as text) = 'scored'
)
select
    lead_scoring_job_id,
    organization_id,
    contact_id,
    score                               as lead_score,
    grade                               as lead_grade,
    band                                as lead_band,
    fit_score,
    intent_score,
    next_best_action,
    completed_at                        as scored_at,
    created_at,
    updated_at
from ranked
where rn = 1
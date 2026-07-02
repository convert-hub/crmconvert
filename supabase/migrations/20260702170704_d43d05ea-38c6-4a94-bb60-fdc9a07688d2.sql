
create or replace function public.pipeline_stage_aggregates(
  _pipeline_id uuid,
  _assignee uuid default null,
  _priority text default null,
  _tag text default null,
  _value_min numeric default null,
  _value_max numeric default null
) returns table(stage_id uuid, cnt bigint, total numeric)
language sql stable security definer set search_path=public as $$
  select o.stage_id, count(*)::bigint, coalesce(sum(o.value),0)::numeric
  from public.opportunities o
  left join public.contacts c on c.id = o.contact_id
  where o.pipeline_id = _pipeline_id
    and exists (
      select 1 from public.pipelines p
      where p.id = _pipeline_id
        and (public.is_saas_admin() or public.is_member_of_tenant(p.tenant_id))
    )
    and (_assignee is null or o.assigned_to = _assignee)
    and (_priority is null or o.priority::text = _priority)
    and (_tag is null or _tag = any(c.tags))
    and (_value_min is null or o.value >= _value_min)
    and (_value_max is null or o.value <= _value_max)
  group by o.stage_id;
$$;

create or replace function public.search_pipeline_opportunities(
  _pipeline_id uuid,
  _term text default null,
  _assignee uuid default null,
  _priority text default null,
  _tag text default null,
  _value_min numeric default null,
  _value_max numeric default null,
  _limit int default 300
) returns setof public.opportunities
language sql stable security definer set search_path=public as $$
  select o.*
  from public.opportunities o
  left join public.contacts c on c.id = o.contact_id
  where o.pipeline_id = _pipeline_id
    and exists (
      select 1 from public.pipelines p
      where p.id = _pipeline_id
        and (public.is_saas_admin() or public.is_member_of_tenant(p.tenant_id))
    )
    and (_assignee is null or o.assigned_to = _assignee)
    and (_priority is null or o.priority::text = _priority)
    and (_tag  is null or _tag = any(c.tags))
    and (_value_min is null or o.value >= _value_min)
    and (_value_max is null or o.value <= _value_max)
    and (
      _term is null
      or o.title ilike '%'||_term||'%'
      or c.name  ilike '%'||_term||'%'
      or (
        length(regexp_replace(_term,'\D','','g')) > 0
        and regexp_replace(coalesce(c.phone,''),'\D','','g')
            ilike '%'||regexp_replace(_term,'\D','','g')||'%'
      )
    )
  order by o.position asc, o.updated_at desc
  limit _limit;
$$;

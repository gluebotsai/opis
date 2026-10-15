{% macro generate_schema_name(custom_schema_name, node) -%}
  {#- Keep custom schemas literal so marts land in webtracking_marts (SQL templates). -#}
  {%- if custom_schema_name is none -%}
    {{ target.schema }}
  {%- else -%}
    {{ custom_schema_name | trim }}
  {%- endif -%}
{%- endmacro %}

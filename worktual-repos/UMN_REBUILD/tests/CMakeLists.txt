function(urs_add_test name src)
  add_executable(${name} ${src} ${UR_SIGNALING_CORE_SOURCES})
  target_include_directories(${name}
    PRIVATE
      ${CMAKE_SOURCE_DIR}/src
      ${CMAKE_SOURCE_DIR}/third_party
      ${HIREDIS_INCLUDE_DIRS}
      ${SOFIA_INCLUDE_DIRS}
  )
  target_compile_options(${name} PRIVATE -Wall -Wextra -Wpedantic)
  target_link_directories(${name} PRIVATE ${SOFIA_LIBRARY_DIRS})
  target_link_libraries(${name} PRIVATE ${UR_SIGNALING_LIBS})
  if(SOFIA_LIBRARY_DIRS)
    set_target_properties(${name} PROPERTIES
      BUILD_RPATH "${SOFIA_LIBRARY_DIRS}"
      INSTALL_RPATH "${SOFIA_LIBRARY_DIRS}"
    )
  endif()
  add_test(NAME ${name} COMMAND ${name})
endfunction()

urs_add_test(ur-signaling-controller-smoke unit/controller_route_smoke.cpp)
urs_add_test(ur-signaling-controller-interrogator-smoke unit/controller_interrogator_smoke.cpp)
urs_add_test(ur-signaling-redis-keys-smoke unit/redis_key_helpers_smoke.cpp)
urs_add_test(ur-signaling-pbx-selector-smoke unit/pbx_selector_smoke.cpp)
urs_add_test(ur-signaling-snapshot-unit unit/interrogator_ttl_snapshot_unit.cpp)
urs_add_test(ur-signaling-logger-redact-smoke unit/logger_redact_smoke.cpp)
urs_add_test(ur-signaling-config-env-smoke unit/config_env_smoke.cpp)

function(urs_add_redis_smoke name src)
  add_executable(${name} ${src} ${UR_SIGNALING_CORE_SOURCES})
  target_include_directories(${name}
    PRIVATE
      ${CMAKE_SOURCE_DIR}/src
      ${CMAKE_SOURCE_DIR}/third_party
      ${HIREDIS_INCLUDE_DIRS}
      ${SOFIA_INCLUDE_DIRS}
  )
  target_compile_options(${name} PRIVATE -Wall -Wextra -Wpedantic)
  target_link_directories(${name} PRIVATE ${SOFIA_LIBRARY_DIRS})
  target_link_libraries(${name} PRIVATE ${UR_SIGNALING_LIBS})
  if(SOFIA_LIBRARY_DIRS)
    set_target_properties(${name} PROPERTIES
      BUILD_RPATH "${SOFIA_LIBRARY_DIRS}"
      INSTALL_RPATH "${SOFIA_LIBRARY_DIRS}"
    )
  endif()
endfunction()

urs_add_redis_smoke(ur-signaling-redis-smoke unit/redis_integration_smoke.cpp)
urs_add_redis_smoke(ur-signaling-interrogator-smoke unit/interrogator_pubsub_smoke.cpp)
urs_add_redis_smoke(ur-signaling-controller-interrogator-redis-smoke unit/controller_interrogator_redis_smoke.cpp)
urs_add_redis_smoke(ur-signaling-sip-invite-smoke unit/sip_invite_smoke.cpp)
urs_add_redis_smoke(ur-signaling-live-call-lookup-smoke unit/live_call_lookup_smoke.cpp)
urs_add_redis_smoke(ur-signaling-redis-failover-smoke unit/redis_failover_smoke.cpp)
urs_add_redis_smoke(ur-signaling-dual-subscriber-smoke unit/dual_subscriber_smoke.cpp)
urs_add_redis_smoke(ur-signaling-invite-livecall-smoke unit/invite_livecall_smoke.cpp)
# Redis/SIP smokes are driven by scripts/*-smoke.sh (SKIP if Redis/sofia down).

# Prefer a WSS-capable Sofia-SIP (NUTAG_WSS_URL). Distro packages (e.g. Ubuntu
# libsofia-sip-ua) often lack WebSocket transport; SGW uses a local 1.13.17 build.

function(_ur_sofia_has_wss include_dir result_var)
  set(_hdr "${include_dir}/sofia-sip/nua_tag.h")
  if(EXISTS "${_hdr}")
    file(READ "${_hdr}" _nua_tag)
    if(_nua_tag MATCHES "NUTAG_WSS_URL")
      set(${result_var} TRUE PARENT_SCOPE)
      return()
    endif()
  endif()
  set(${result_var} FALSE PARENT_SCOPE)
endfunction()

set(UR_SIGNALING_HAVE_SOFIA_WSS FALSE)
set(UR_SOFIA_FROM_PREFIX FALSE)

if(DEFINED ENV{UR_SOFIA_PREFIX} AND NOT UR_SOFIA_PREFIX)
  set(UR_SOFIA_PREFIX "$ENV{UR_SOFIA_PREFIX}")
endif()
if(NOT UR_SOFIA_PREFIX AND DEFINED ENV{HOME})
  set(_default_sofia "$ENV{HOME}/.local/sofia-sip-1.13.17")
  if(EXISTS "${_default_sofia}/include/sofia-sip-1.13/sofia-sip/nua_tag.h")
    set(UR_SOFIA_PREFIX "${_default_sofia}")
  endif()
endif()

if(UR_SOFIA_PREFIX)
  set(_sofia_inc_candidates
    "${UR_SOFIA_PREFIX}/include/sofia-sip-1.13"
    "${UR_SOFIA_PREFIX}/include/sofia-sip-1.12"
    "${UR_SOFIA_PREFIX}/include"
  )
  set(_sofia_lib_candidates
    "${UR_SOFIA_PREFIX}/lib"
    "${UR_SOFIA_PREFIX}/lib64"
  )
  foreach(_inc IN LISTS _sofia_inc_candidates)
    _ur_sofia_has_wss("${_inc}" _has_wss)
    if(_has_wss)
      foreach(_libdir IN LISTS _sofia_lib_candidates)
        find_library(UR_SOFIA_LIBRARY
          NAMES sofia-sip-ua
          PATHS "${_libdir}"
          NO_DEFAULT_PATH
        )
        if(UR_SOFIA_LIBRARY)
          set(SOFIA_INCLUDE_DIRS "${_inc}")
          set(SOFIA_LIBRARY_DIRS "${_libdir}")
          set(SOFIA_LIBRARIES "${UR_SOFIA_LIBRARY}")
          set(UR_SIGNALING_HAVE_SOFIA_WSS TRUE)
          set(UR_SOFIA_FROM_PREFIX TRUE)
          message(STATUS "Using WSS Sofia from UR_SOFIA_PREFIX=${UR_SOFIA_PREFIX}")
          break()
        endif()
      endforeach()
    endif()
    if(UR_SOFIA_FROM_PREFIX)
      break()
    endif()
  endforeach()
endif()

if(NOT UR_SOFIA_FROM_PREFIX)
  pkg_check_modules(SOFIA REQUIRED sofia-sip-ua)
  foreach(_inc IN LISTS SOFIA_INCLUDE_DIRS)
    _ur_sofia_has_wss("${_inc}" _has_wss)
    if(_has_wss)
      set(UR_SIGNALING_HAVE_SOFIA_WSS TRUE)
      break()
    endif()
  endforeach()
  if(UR_SIGNALING_HAVE_SOFIA_WSS)
    message(STATUS "pkg-config Sofia has NUTAG_WSS_URL")
  else()
    message(WARNING
      "Sofia-SIP lacks NUTAG_WSS_URL — WSS listen disabled at compile time. "
      "Install WSS Sofia (see docs/wss.md) and set UR_SOFIA_PREFIX, then reconfigure.")
  endif()
endif()

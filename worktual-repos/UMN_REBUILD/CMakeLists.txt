cmake_minimum_required(VERSION 3.21)

project(ur-signaling
  VERSION 0.1.0
  LANGUAGES CXX
  DESCRIPTION "Merged signaling gateway + interrogator node"
)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(UR_SIGNALING_VERSION "${PROJECT_VERSION}")

find_package(PkgConfig REQUIRED)
find_package(OpenSSL REQUIRED)
pkg_check_modules(HIREDIS REQUIRED hiredis)
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(FindWssSofia)

include(FetchContent)
set(REDIS_PLUS_PLUS_CXX_STANDARD 17 CACHE STRING "" FORCE)
set(REDIS_PLUS_PLUS_BUILD_TEST OFF CACHE BOOL "" FORCE)
set(REDIS_PLUS_PLUS_BUILD_STATIC ON CACHE BOOL "" FORCE)
set(REDIS_PLUS_PLUS_BUILD_SHARED OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
  redis_plus_plus
  GIT_REPOSITORY https://github.com/sewenew/redis-plus-plus.git
  GIT_TAG 1.3.12
)
FetchContent_MakeAvailable(redis_plus_plus)

set(UR_SIGNALING_CORE_SOURCES
  ${CMAKE_CURRENT_SOURCE_DIR}/src/common/Messages.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/src/config/Config.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/src/logging/Logger.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/src/controller/Controller.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/src/controller/StubEchoModule.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/src/redis/RedisClient.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/src/redis/PbxPresenceStore.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/src/redis/LiveCallStore.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/src/redis/RegistrationStore.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/src/interrogator/PbxSelector.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/src/interrogator/InterrogatorService.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/src/sip/DigestAuth.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/src/sip/SipService.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/src/sip/sofia/SofiaAdapter.cpp
)

# redis-plus-plus static target is redis++_static (alias redis++::redis++_static).
set(UR_SIGNALING_REDIS_LIBS redis++_static ${HIREDIS_LIBRARIES} pthread)
# OpenSSL::SSL needed for Sofia WSS/TLS transports.
set(UR_SIGNALING_LIBS ${UR_SIGNALING_REDIS_LIBS} ${SOFIA_LIBRARIES} OpenSSL::SSL OpenSSL::Crypto)

add_executable(ur-signaling
  src/app/main.cpp
  src/app/Application.cpp
  ${UR_SIGNALING_CORE_SOURCES}
)

target_include_directories(ur-signaling
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party
    ${HIREDIS_INCLUDE_DIRS}
    ${SOFIA_INCLUDE_DIRS}
)

if(UR_SIGNALING_HAVE_SOFIA_WSS)
  add_compile_definitions(UR_SIGNALING_HAVE_SOFIA_WSS=1)
endif()

target_compile_definitions(ur-signaling
  PRIVATE
    UR_SIGNALING_VERSION="${UR_SIGNALING_VERSION}"
)

target_compile_options(ur-signaling
  PRIVATE
    -Wall
    -Wextra
    -Wpedantic
)

target_link_libraries(ur-signaling PRIVATE ${UR_SIGNALING_LIBS})
target_link_directories(ur-signaling PRIVATE ${SOFIA_LIBRARY_DIRS})
if(SOFIA_LIBRARY_DIRS)
  set_target_properties(ur-signaling PROPERTIES
    BUILD_RPATH "${SOFIA_LIBRARY_DIRS}"
    INSTALL_RPATH "${SOFIA_LIBRARY_DIRS}"
  )
endif()

if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU" AND CMAKE_CXX_COMPILER_VERSION VERSION_LESS 12)
  message(WARNING "GCC ${CMAKE_CXX_COMPILER_VERSION} detected; GCC 12+ recommended for C++23")
endif()

enable_testing()
add_subdirectory(tests)

# Phase 1: Foundation (Monorepo & Docker Infrastructure)

## 1. Overview & Architecture
Establish the enterprise monorepo workspace and containerized development environment hosting Asterisk PBX, PostgreSQL, and Redis.

```text
telephony-platform/
├── package.json (NPM Workspaces Root)
├── docker-compose.yml
├── docker/
│   └── asterisk/
│       ├── Dockerfile
│       └── config/
│           ├── asterisk.conf
│           ├── pjsip.conf
│           ├── extensions.conf
│           ├── ari.conf
│           └── manager.conf
├── apps/
├── services/
├── adapters/
└── shared/
```

---

## 2. Step-by-Step Implementation Instructions

### Step 1.1: Root Workspace Initialization
Initialize `package.json` with workspace configuration:
```json
{
  "name": "telephony-platform",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "apps/*",
    "services/*",
    "adapters/*",
    "shared"
  ],
  "scripts": {
    "build": "npm run build --workspaces",
    "docker:up": "docker-compose up -d",
    "docker:down": "docker-compose down"
  }
}
```

### Step 1.2: Custom Asterisk Dockerfile (`docker/asterisk/Dockerfile`)
Build a dedicated Ubuntu 22.04 Asterisk image with essential modules:
```dockerfile
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    asterisk \
    asterisk-modules \
    asterisk-pjsip \
    asterisk-ari \
    asterisk-manager \
    iputils-ping \
    curl \
    vim \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 5060/udp 5060/tcp 8088/tcp 5038/tcp 10000-20000/udp

CMD ["asterisk", "-f", "-vvvddd"]
```

### Step 1.3: Asterisk Configurations (`docker/asterisk/config/`)

#### A. PJSIP Transport & Extensions (`pjsip.conf`)
```ini
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060

[101]
type=endpoint
context=from-internal
disallow=all
allow=ulaw,alaw
auth=101
aors=101

[101]
type=auth
auth_type=userpass
password=password101
username=101

[101]
type=aor
max_contacts=2

[102]
type=endpoint
context=from-internal
disallow=all
allow=ulaw,alaw
auth=102
aors=102

[102]
type=auth
auth_type=userpass
password=password102
username=102

[102]
type=aor
max_contacts=2
```

#### B. Stasis Dialplan Routing (`extensions.conf`)
```ini
[general]
static=yes
writeprotect=no

[from-internal]
exten => _X.,1,NoOp(Routing call ${EXTEN} to Telephony Platform Stasis App)
exten => _X.,n,Stasis(telephony)
exten => _X.,n,Hangup()
```

#### C. ARI Credentials (`ari.conf`)
```ini
[general]
enabled = yes
pretty = yes

[telephony]
type = user
read_only = no
password = telephony_password
password_format = plain
```

#### D. AMI Credentials (`manager.conf`)
```ini
[general]
enabled = yes
port = 5038
bindaddr = 0.0.0.0

[telephony]
secret = telephony_password
read = system,call,log,verbose,command,agent,user,config,dtmf,reporting,cdr,dialplan,originate,message
write = system,call,log,verbose,command,agent,user,config,dtmf,reporting,cdr,dialplan,originate,message
```

### Step 1.4: Docker Compose Setup (`docker-compose.yml`)
```yaml
version: '3.8'

services:
  asterisk:
    build:
      context: ./docker/asterisk
    container_name: asterisk
    network_mode: host
    volumes:
      - ./docker/asterisk/config:/etc/asterisk
    restart: unless-stopped

  db:
    image: postgres:15
    container_name: telephony-db
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
      POSTGRES_DB: telephony
    ports:
      - "5432:5432"
    volumes:
      - db_data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7
    container_name: telephony-redis
    ports:
      - "6379:6379"
    restart: unless-stopped

volumes:
  db_data:
```

---

## 3. Verification & Validation Steps
1. Execute `docker-compose up --build -d`.
2. Verify container statuses with `docker-compose ps`.
3. Test Asterisk CLI access: `docker exec -it asterisk asterisk -rx "pjsip show endpoints"`.
4. Register Linphone or MicroSIP client using Extension `101` (Password: `password101`, Server: `localhost:5060`).
5. Confirm successful SIP registration in Asterisk CLI logs.

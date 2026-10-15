FROM ubuntu:22.04

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

# Update and install Asterisk (includes built-in PJSIP, ARI, and AMI modules)
RUN apt-get update && apt-get install -y \
    asterisk \
    asterisk-modules \
    iputils-ping \
    curl \
    vim \
    && rm -rf /var/lib/apt/lists/*

# Copy custom configuration files into default Asterisk directory
COPY config/*.conf /etc/asterisk/

CMD ["asterisk", "-f", "-vvvddd"]

#!/bin/sh
set -e

export NODE_ENV=production

exec node server.mjs

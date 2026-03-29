#!/bin/bash

# Script per avviare il server web SEO Checker

# Colori per output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "════════════════════════════════════════"
echo "  🚀 Avvio SEO Checker Web Interface"
echo "════════════════════════════════════════"
echo ""

# Controlla se Node.js è installato
if ! command -v node &> /dev/null; then
    echo "❌ Errore: Node.js non è installato"
    echo "   Installa Node.js da https://nodejs.org"
    exit 1
fi

# Controlla se ci sono processi sulla porta 3000
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo -e "${YELLOW}⚠️  Porta 3000 già in uso${NC}"
    echo "   Il server proverà automaticamente altre porte (3001-3010)"
    echo ""
fi

# Avvia il server
echo -e "${GREEN}✅ Avvio server...${NC}"
echo ""

node seo-web-server.js

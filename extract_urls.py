#!/usr/bin/env python3
import csv
import re

def extract_urls_from_corrupted_csv():
    """Estrae solo gli URL dal file CSV corrotto"""
    urls = []
    
    # Prima aggiungo l'header
    urls.append(['URL'])
    
    # Leggo il file corrotto riga per riga
    with open('prodotti.csv', 'r', encoding='utf-8') as file:
        lines = file.readlines()
    
    # Salto la prima riga (header corrotto)
    for i, line in enumerate(lines[1:], 1):
        # Cerco pattern URL all'inizio della riga dopo le virgolette
        # Il formato dovrebbe essere: "URL","Testo",...
        match = re.match(r'^"([^"]*)"', line.strip())
        if match:
            url = match.group(1)
            # Verifico che sia effettivamente un URL
            if url.startswith(('http://', 'https://', 'mailto:', 'tel:')):
                urls.append([url])
            else:
                print(f"Riga {i}: '{url}' non sembra un URL valido")
        else:
            print(f"Riga {i}: non riesco a estrarre URL da: {line[:50]}...")
    
    # Scrivo il file delle URL
    with open('urls_only.csv', 'w', encoding='utf-8', newline='') as outfile:
        writer = csv.writer(outfile)
        writer.writerows(urls)
    
    print(f"Estratte {len(urls)-1} URL e salvate in urls_only.csv")
    return len(urls)-1

if __name__ == "__main__":
    count = extract_urls_from_corrupted_csv()
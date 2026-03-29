#!/usr/bin/env python3
import csv

def remove_duplicates():
    """Rimuove i duplicati dal file URLs mantenendo solo la prima occorrenza"""
    urls_seen = set()
    unique_urls = []
    
    # Aggiungo l'header
    unique_urls.append(['URL'])
    
    # Leggo tutti gli URL e tengo solo quelli unici
    with open('urls_only.csv', 'r', encoding='utf-8') as file:
        reader = csv.reader(file)
        next(reader)  # Salto l'header
        
        for row in reader:
            if row and len(row) > 0:
                url = row[0]
                if url not in urls_seen:
                    urls_seen.add(url)
                    unique_urls.append([url])
    
    # Scrivo il file senza duplicati
    with open('urls_only_unique.csv', 'w', encoding='utf-8', newline='') as outfile:
        writer = csv.writer(outfile)
        writer.writerows(unique_urls)
    
    print(f"File originale: {len(unique_urls)} righe (incluso header)")
    print(f"File pulito: urls_only_unique.csv creato")
    print(f"URL unici: {len(unique_urls)-1}")

if __name__ == "__main__":
    remove_duplicates()
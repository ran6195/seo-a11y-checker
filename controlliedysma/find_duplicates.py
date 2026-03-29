#!/usr/bin/env python3
import csv
from collections import Counter

def find_duplicates_in_urls():
    """Trova gli URL duplicati nel file urls_only.csv"""
    urls = []
    
    # Leggo tutti gli URL dal file
    with open('urls_only.csv', 'r', encoding='utf-8') as file:
        reader = csv.reader(file)
        next(reader)  # Salto l'header
        
        for row in reader:
            if row and len(row) > 0:
                urls.append(row[0])
    
    # Conto le occorrenze di ogni URL
    url_counts = Counter(urls)
    
    # Trovo i duplicati
    duplicates = {url: count for url, count in url_counts.items() if count > 1}
    
    print(f"Totale URL analizzati: {len(urls)}")
    print(f"URL unici: {len(url_counts)}")
    print(f"URL duplicati trovati: {len(duplicates)}")
    print()
    
    if duplicates:
        print("DUPLICATI TROVATI:")
        print("=" * 50)
        for url, count in sorted(duplicates.items(), key=lambda x: x[1], reverse=True):
            print(f"• {url}")
            print(f"  Occorrenze: {count}")
            print()
    else:
        print("✅ Nessun duplicato trovato!")
    
    return duplicates

if __name__ == "__main__":
    duplicates = find_duplicates_in_urls()
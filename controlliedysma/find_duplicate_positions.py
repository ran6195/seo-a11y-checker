#!/usr/bin/env python3
import csv

def find_duplicate_positions():
    """Trova le posizioni esatte degli URL duplicati"""
    urls_with_positions = []
    
    # Leggo tutti gli URL con le loro posizioni
    with open('urls_only.csv', 'r', encoding='utf-8') as file:
        reader = csv.reader(file)
        next(reader)  # Salto l'header
        
        for line_num, row in enumerate(reader, start=2):  # Start=2 perché l'header è riga 1
            if row and len(row) > 0:
                urls_with_positions.append((row[0], line_num))
    
    # Raggruppo per URL
    url_positions = {}
    for url, position in urls_with_positions:
        if url not in url_positions:
            url_positions[url] = []
        url_positions[url].append(position)
    
    # Trovo i duplicati con le loro posizioni
    duplicates_with_positions = {url: positions for url, positions in url_positions.items() if len(positions) > 1}
    
    print(f"Totale URL analizzati: {len(urls_with_positions)}")
    print()
    
    if duplicates_with_positions:
        print("DUPLICATI CON POSIZIONI:")
        print("=" * 60)
        for url, positions in duplicates_with_positions.items():
            print(f"URL: {url}")
            print(f"Trovato alle righe: {', '.join(map(str, positions))}")
            print(f"Occorrenze: {len(positions)}")
            print()
    else:
        print("✅ Nessun duplicato trovato!")

if __name__ == "__main__":
    find_duplicate_positions()
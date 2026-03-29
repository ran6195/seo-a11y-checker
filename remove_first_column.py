#!/usr/bin/env python3
import csv
import sys

def remove_first_column(input_file, output_file):
    """Rimuove la prima colonna da un file CSV mantenendo la corretta gestione delle virgolette"""
    with open(input_file, 'r', encoding='utf-8', newline='') as infile:
        reader = csv.reader(infile)
        
        with open(output_file, 'w', encoding='utf-8', newline='') as outfile:
            writer = csv.writer(outfile)
            
            for row in reader:
                # Rimuovi la prima colonna (indice 0) se la riga non è vuota
                if row:
                    new_row = row[1:]  # Prendi tutto tranne il primo elemento
                    writer.writerow(new_row)

if __name__ == "__main__":
    input_file = "prodotti.csv"
    output_file = "prodotti_temp.csv"
    
    remove_first_column(input_file, output_file)
    print(f"Prima colonna rimossa da {input_file} e salvato in {output_file}")
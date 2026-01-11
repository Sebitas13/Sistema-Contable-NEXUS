import zipfile
import re
import sys
import os

print(f"Analyzing in {os.getcwd()}")
try:
    with zipfile.ZipFile('TRIBUTOS FINALES.xlsm', 'r') as z:
        if 'xl/workbook.xml' in z.namelist():
            wb_xml = z.read('xl/workbook.xml').decode('utf-8')
            sheets = re.findall(r'<sheet [^>]*name="([^"]+)"', wb_xml)
            with open('analysis_output.txt', 'w', encoding='utf-8') as f:
                f.write("Sheets found:\n")
                for s in sheets:
                    f.write(f"- {s}\n")
            print("Analysis complete. Wrote to analysis_output.txt")
        else:
            print("Could not find xl/workbook.xml")
except Exception as e:
    print(f"Error: {e}")
    with open('analysis_output.txt', 'w') as f:
        f.write(f"Error: {e}")

from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from pathlib import Path
p=Path('tests/fixtures/recibo-ficticio-qa.pdf')
c=canvas.Canvas(str(p),pagesize=(595,842))
c.setFillColor(HexColor('#173f3c'));c.rect(0,690,595,152,fill=1,stroke=0)
c.setFillColorRGB(1,1,1);c.setFont('Helvetica-Bold',24);c.drawString(46,776,'CARAHUE / PRUEBA LOCAL')
c.setFont('Helvetica',13);c.drawString(46,743,'Documento sintetico para verificar carga y descarga')
c.setFillColor(HexColor('#b9572c'));c.setFont('Helvetica-Bold',18);c.drawString(46,637,'FICTICIO - SIN VALIDEZ LABORAL')
c.setFillColor(HexColor('#173f3c'));c.setFont('Helvetica',12)
for y,line in zip([586,551,516,481,421,386],['Persona: Empleado ficticio QA','Periodo de ejemplo: Septiembre 2026','Importes: no incluidos','Firma: no incluida ni verificada','Esta muestra no es un recibo de sueldo.','No contiene datos personales reales.']):c.drawString(46,y,line)
c.setStrokeColor(HexColor('#ccd8d0'));c.line(46,125,549,125)
c.setFont('Helvetica',10);c.drawString(46,103,'Solo para pruebas del panel privado de RRHH. Pagina 1 de 1.')
c.save()
print(str(p.resolve()))

@echo off
REM ==================================================================
REM  DURAN CARASSO - Fabrica de carruseles
REM  Instalacion completa en un solo archivo. Doble clic y listo.
REM  No necesita ningun otro fichero: el parche va incrustado aqui.
REM ==================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Duran Carasso - instalando fabrica de carruseles

echo.
echo  ================================================
echo   DURAN CARASSO - Fabrica de carruseles
echo  ================================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo  ERROR: no tienes Git instalado.
  echo  Descargalo aqui: https://git-scm.com/download/win
  echo  Instalalo, cierra esta ventana y vuelve a hacer doble clic.
  pause & exit /b 1
)
where python >nul 2>nul
if errorlevel 1 (
  echo  ERROR: no tienes Python instalado.
  echo  Descargalo aqui: https://www.python.org/downloads/
  echo  IMPORTANTE: marca la casilla "Add python.exe to PATH".
  pause & exit /b 1
)

set "BASE=%~dp0"
set "DEST=%BASE%carrusel-factory"
set "TMPD=%BASE%_parche_tmp"

echo  [1/6] Extrayendo el parche...
if exist "%TMPD%" rd /s /q "%TMPD%"
mkdir "%TMPD%"
call :ESCRIBIR_B64 "%TMPD%\patch.b64"
certutil -f -decode "%TMPD%\patch.b64" "%TMPD%\patch.zip" >nul || (echo  ERROR decodificando el parche. & pause & exit /b 1)
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%TMPD%\patch.zip' -DestinationPath '%TMPD%\p' -Force" || (echo  ERROR descomprimiendo el parche. & pause & exit /b 1)

if not exist "%DEST%\scripts\generar.py" (
  echo  [2/6] Descargando carrusel-factory...
  git clone https://github.com/david-ai-pro/carrusel-factory "%DEST%" || (echo  ERROR al descargar. Revisa tu conexion. & pause & exit /b 1)
) else (
  echo  [2/6] carrusel-factory ya estaba descargado.
)

cd /d "%DEST%"

if not exist ".venv\Scripts\python.exe" (
  echo  [3/6] Creando el entorno de Python...
  python -m venv .venv || (echo  ERROR creando el entorno. & pause & exit /b 1)
)

echo  [4/6] Instalando dependencias ^(tarda un par de minutos^)...
.venv\Scripts\python.exe -m pip install -q --upgrade pip >nul 2>nul
.venv\Scripts\python.exe -m pip install -q -r requirements.txt || (echo  ERROR instalando dependencias. & pause & exit /b 1)
.venv\Scripts\python.exe -m playwright install chromium || (echo  ERROR instalando Chromium. & pause & exit /b 1)

echo  [5/6] Aplicando tu marca y el estilo foto-real...
if exist "scripts\generar.py" if not exist "scripts\generar.py.bak" copy /y "scripts\generar.py" "scripts\generar.py.bak" >nul
xcopy /e /i /y "%TMPD%\p\estilos\foto-real" "estilos\foto-real" >nul
copy /y "%TMPD%\p\scripts\generar.py" "scripts\generar.py" >nul
copy /y "%TMPD%\p\config.json" "config.json" >nul
copy /y "%TMPD%\p\trabajo\carrusel-foto-real.json" "trabajo\carrusel-foto-real.json" >nul
copy /y "%TMPD%\p\trabajo\carrusel-ia.json" "trabajo\carrusel.json" >nul
copy /y "%TMPD%\p\trabajo\carrusel-ia.json" "trabajo\carrusel-ia.json" >nul
if not exist "fotos" mkdir "fotos"
rd /s /q "%TMPD%"

echo  [6/6] Generando tu primer carrusel...
echo.
.venv\Scripts\python.exe scripts\generar.py
if errorlevel 1 (
  echo.
  echo  Fallo la generacion. Copia el texto de arriba y pasaselo a Claude.
  pause & exit /b 1
)

echo.
echo  ================================================
echo   LISTO. Tus imagenes estan en:
echo   %DEST%\output
echo  ================================================
echo.
echo   Para el siguiente carrusel, abre esta carpeta:
echo   %DEST%
echo   y haz doble clic en run.bat
echo.
start "" "%DEST%\output"
pause
exit /b 0

:ESCRIBIR_B64
if exist %1 del %1
>>%1 echo UEsDBAoAAAAAABRTLl0AAAAAAAAAAAAAAAAIABwAdHJhYmFqby9VVAkAA2fLp2pny6dqdXgLAAEE
>>%1 echo AAAAAAQAAAAAUEsDBBQAAAAIABRTLl3J5kNvHgIAAJsFAAAfABwAdHJhYmFqby9jYXJydXNlbC1m
>>%1 echo b3RvLXJlYWwuanNvblVUCQADZ8unamfLp2p1eAsAAQQAAAAABAAAAACNlMFu2zAMhu95CsJnL3Xb
>>%1 echo pAVyKdJhhwHdZQV6mXdgbDZTJ0ueJGdLi77ULjsOyJONtJ04dTzAOUUi/esj9VMvE4AoUIHRAqIH
>>%1 echo pTUCGbhXYU0+iiVIPihtJfxog33nCHUTeLSuwFBHZot5s5cFEXphSVXWkZ+0imI54VeTuVyTyRFC
>>%1 echo BRvlVahPyyuHJkOH3tupHAtRTgG1pr0CvNbqXquc4wv4wiuQYwwvzjnfWS2536z9zp83v4iC+lFR
>>%1 echo TRQddptQUKFqijqp+ZCTVeSaIpIkgWL3G3Z/IIGcy1bBOmW9bHAZAT2ghgKdoEuX9t3yZ8n59Klc
>>%1 echo twUckC86ZC4IHf9nmvgt8gcNHrU1DdIR8l31DDmBr1xqgs0tkIZcYRQfIb9ffrr9uPy8gLaTIPfG
>>%1 echo i1Zz2nWpx3sxxHs5hvcOIbOZMlhrH/EuV4pcwNRsoeRb5pZtlNPjeEHvVffIfeDLIeDZSOBAzuFz
>>%1 echo TXwEzJ0vKDibGs7le/XgCSr/H2JxBoO2UrAF9gaZgJlq+9wnng0Rz0daorMf03TI95UKlJrSKZOp
>>%1 echo Ukb0xMUH4BUaK4738k0MG5lwlo1bLzNzn3g+RHw1kph7YZ2xvR4vYQ6FMhXrp0Z82YzPMHEuYFwY
>>%1 echo 34T4gnjeoNS4xbPMalrzKA5AXw1BX3fQ8lZ1034M/VA/TRpPJm/3lz2zoUKYuWvIvijQ4M0bY4x7
>>%1 echo 4gacfN0CM+/XyevkH1BLAwQUAAAACAAUUy5dKEcEz4gDAADPCAAAGAAcAHRyYWJham8vY2FycnVz
>>%1 echo ZWwtaWEuanNvblVUCQADZ8unamfLp2p1eAsAAQQAAAAABAAAAACllc+OG0UQxu/7FCWfnZWAhMNe
>>%1 echo EKAckBIJKUdAUXmmPNO4u2voP/aaKM+GxJPxVbeNcTbLJsph5Znu2q6aX3319bsbolWRwKs7Wv0U
>>%1 echo iySnSTL9UYXwu7jEkXz9c7W2QMnFebVQ52suiUd95rjvBR3F61sXeJJoIYt67yIXpzE/2/p63+O2
>>%1 echo mgKXdsjzuxd9bSiW/x0qcUvbOchmtbbC7nvk9zhzZCqV9i67wiSRxoraBk6cs95KtvhRCnsv5xPo
>>%1 echo fTs9ezdi/45+wRtZGqvvK8Qn9RY7q+5aOldq/7wLiV/jQxQouErqlb7SxirLgkqoRqaBM9NGo5U5
>>%1 echo ymXJwiRy0MS3dsZW4whe/HZJGpZihwUXwc+7XCjI6FADcoqldXsXJ0qqgbjQpH4EgVlrWpPnNAkd
>>%1 echo HE47ZLy6iC0jV1H1mg6cAqENoOWxOc1ljbJkQQgWeBgkFoRxGmYkHHrcMmvRKfEyH9cUapFxTVHb
>>%1 echo qe1hEV3AuQP+F+nXF6QAzgnPwHkF9hWTJoeUPEAX1yjf1ERHUohMiO2r8OHiaXR8Sy8zeaRNLkjq
>>%1 echo xAP6ETQTo1Vdrx5vQUrS/BjfXKN3hRrXQUi3xGS6TfED3nvnPRtaK2WL9agaz/Ry0YjlONJBFWCy
>>%1 echo bgvlmTv/RqvDzbvj/4J9mug3TxN96WlvMK9ZvpZoNKpsvIkgMEC5JLeEBmSJueE3eXJYgKSOWAVp
>>%1 echo bHErB28DqD0pVRK8HzEW9zUdyZ3GZk0zUNEgDmqckH9hL7R4RmsTFOk91jK2sAp5DjNqgyrRUNjF
>>%1 echo 0IGOfDzx7kTtiFLkC4E+fxroa7aPQLaMAYtQo+Zrtj87QakGFcrhNnEKhca9/C6YJtpA3xCy1YC5
>>%1 echo b5QhsuZZg4uDQjqPS3SAimEai4nzPLVdcIZtTcq7Jrumvz7rQ02FXQR9yPnUiWs5zxrk5AQZXkhX
>>%1 echo YO3wBwZgTuo+m+6LTzIA3Bsxu4fzfzZdsEOa/giRQIipiAGmN65MaItiMOlHSSPHI/hLVvzZWoDn
>>%1 echo jqjdRsJretQGhAPam8k8E0m0lvbbC7ML62QNH/MEu03MiyeoOZP9HwpazHLRWJo4wZmh5Zp3Vz5r
>>%1 echo bmH8zyNy7sEXqfnbC2+7Qq9A//3XDzXj4mkXEGf33TXsT7xRP0Jv5LSDoHX8UGUN0KV1uKc2Hrbc
>>%1 echo b6n28adLCuwUj9N/ATWvxHhIt4DPxQIqv928v/kHUEsDBAoAAAAAABRTLl0AAAAAAAAAAAAAAAAI
>>%1 echo ABwAc2NyaXB0cy9VVAkAA2fLp2pny6dqdXgLAAEEAAAAAAQAAAAAUEsDBBQAAAAIABRTLl2sF9Fi
>>%1 echo ZQUAAEEOAAASABwAc2NyaXB0cy9nZW5lcmFyLnB5VVQJAANny6dqZ8unanV4CwABBAAAAAAEAAAA
>>%1 echo AI1Xy27jNhTd6ysu1AKWEFnJDFqgMOoCg3RQdDMzSB+b1BBoi7KZUKRKUmhSw3/RZTfzAV0X6LL5
>>%1 echo k35JLx+yJFtJOwFG8n3z3MtDKo7j9+rnlmpDSqkWwCkFo8ia3MnLDVGq1ZTnd1qKDLZUUEWASw2V
>>%1 echo FCU+vn0DiWZAOaA/49LpWk3S6BEUFSVV7Ffv8OHdN1AxQTjVQAXI1jStufxS83Y7LymfG1qTry7z
>>%1 echo KPpBywWoVuRrYkJGBQAJSptHs5MC9EaxxujLoMybxzSK4zhidSOVAVtr9y5196YfddS91xIzSl2w
>>%1 echo mmCMTurrjSol67AaDUGFOGyJKrzUW7T4eqrfSFGxbQY1URsSfrWKlCTDBRn83642A0MfjCx2puZR
>>%1 echo FJW0QnsmknQR4TKh4UQUDSydRxKHTsQZxKNmxKmzZhUIaZeZN8TscqYrxmniY4SALqhiwiTx25ub
>>%1 echo 9zcL9AD6wLR5ps95iD1w/PD0ByJGgcA1J21JbQex55sdtghHB81oQxR1shAKEmr7tCZWaAtKbbCa
>>%1 echo KjmMj13JsRaTvEojJ/yFmR3IhoqwiAxTbWTJxHYZt6aafxGnQHD8BmtDO4TLVc4lKZMqhNpUW5SP
>>%1 echo WpOMUDtrU4Iu56i9efpLWMx2mLc3lmBaH2ECr6/ZNFgLmB0jQM28/wwS4yDctsIQ9fTR7ZeSGKnT
>>%1 echo F7HC0SEtN9qustrmW4qZOxkOzP7gfYWs14qG4UVbC5g39iJEVKpjsJEGp64k6n6+lrwMlRj12CN0
>>%1 echo jDnaIMkoo3ejDxvaGPiR8Ja+VQoTIpr0FOuqG9E9Pby08kqqGvEZLSbIplbTqXA5ny0+D4E9CYxC
>>%1 echo eFGghalAYwMMJ4iQ8zXBB5k3SobQSIAFIxh6LSVPPAy3MXZYUxOvfChr40gULeO096ukW9d/eiKD
>>%1 echo YMKmd8ZfdWOKNdEU/addBza2+jjA6cZwOEVOMBghv1PMg0EjP/PObEdEyakHaiD27Q8JeveN5Gg3
>>%1 echo CuBEhe39hjWEW5dPXrl/XWk4WA015MiH/tyIPZUmfevs8TEkSUQlDaPiDqrlkSPvJJJtCIsOvgk6
>>%1 echo VIpGNbmnJVO6t3FkWcj75feqpaEuzVlJ9Wh6vAiLuF2FrSIN4WjCkc288kg/QbWEq3OSHnAoso5h
>>%1 echo eMqFdC+yAUMIbEG3Kw+ctASPCfKrbssAnlcihOrTWvIM4y0G8f1sWsRQ/04KetRg+cdBxQGA4yaz
>>%1 echo m6+P67uHegx/67Ur69ufVWStk6MqRY7EyXVd7oWjaNOHnc1xknaCUNyqYS8O/vgTm5YKo/C+QsAt
>>%1 echo ZLbXtzP7NlsdZkOcp/Aeykc42Vp6cuQBKaSCEU5+0xd+M55CNoo3mlk/qBlUPsR8LxZXr8tD3oht
>>%1 echo /H+A6iNPwmWLwZTJkEcuIMa/C9/AcdmrNNcG72HJOVQd9ADf9aj7yxrG8Cu0N0c8CmHvKfWQ51Og
>>%1 echo jy9qebjw+S0bCs26wyAL1pmlsWyA43lYvzculqfxnbwoaeLlvSNW6i5tiM9+FC02zLR4UC4Gl7ok
>>%1 echo NDqoHA2m2dgNx081025BNenmeXnR8/GJXqBOnMgc1dhM9nmiU9JqQmL7w2U9MaKG4R3PkMlqj8rT
>>%1 echo eg89UxGcAvIsA1eeOJ8ZZ8dqOWnwRlgmSdeHYXuzkCANPNhN3033+WGnbe9Wf+ho++8/u6vLbD+6
>>%1 echo rBxmVtddL/bhZTCd/iMh94/CyJLocExnvtbhPPbH3qi2+Cfxz++/wXXH8hyPl+Ot+GTz6AV0xfdX
>>%1 echo fjen53cngGs32AR3xkOO3yZPH+2OsV9pC/h0773y19XhLNW1bwbeu0JbrAl+LlVQFILUtCjsWRUX
>>%1 echo hf1SKYp4EY51+9kS/QtQSwMECgAAAAAAFFMuXQAAAAAAAAAAAAAAAAgAHABlc3RpbG9zL1VUCQAD
>>%1 echo Z8unamfLp2p1eAsAAQQAAAAABAAAAABQSwMECgAAAAAAFFMuXQAAAAAAAAAAAAAAABIAHABlc3Rp
>>%1 echo bG9zL2ZvdG8tcmVhbC9VVAkAA2fLp2pny6dqdXgLAAEEAAAAAAQAAAAAUEsDBBQAAAAIABRTLl1d
>>%1 echo bgCzowAAAN0AAAAdABwAZXN0aWxvcy9mb3RvLXJlYWwvcHJlc2V0Lmpzb25VVAkAA2fLp2pny6dq
>>%1 echo dXgLAAEEAAAAAAQAAAAATY6xCsIwEIb3PsVxcykUVDCbQ52cuoqEM0kl0uRCkoIivrtJuzjd8X/c
>>%1 echo /92nAUBtkoo2KMseBeCZM8M4nC6gDcwEIXKwRpMGxY5hYq+5Lbsv/BGpAIY3ZPMqZ8Yr66iDQdvM
>>%1 echo 0dK8dixP7rCtqiWRXAukpeKaaE7mD2SWq62yHJcNlcSFLO+UTH1vK5o4OsqcSnLFndhjC9iLvo6j
>>%1 echo 6A94a77ND1BLAwQUAAAACAAUUy5dOlgqp70CAABzBgAAHAAcAGVzdGlsb3MvZm90by1yZWFsL2Vz
>>%1 echo dGlsby5jc3NVVAkAA2fLp2pny6dqdXgLAAEEAAAAAAQAAAAAnVTbjpswEH3PV1iq0gQ1Zg0JWRa0
>>%1 echo 6kp9qNS/cLAh7oLt2iaXrfrvHQPJkkv3oQ8gbA/HZ+acmRfRaGUcak09n22d0zZ7eCiVdDaslKpq
>>%1 echo TrWwYaGah8La+GtJG1Efn78p0yhDpfvynRraKMmyfbV1L0tC8oSQz0PYD2Xd+8FqOGTC6poen+2e
>>%1 echo 6lmQTyahrQXj6PcEIa2scELJDBleUyd2PEd7wdw2QxEh0xxtuQC8YQU/bGjxWhnVSoZFQyueoR01
>>%1 echo c4whBaaCqwgr3iCgUDtu8vH++60Flw4OL38rVK3MCbihpqAd8JBHhsqaH/LujZkwvBigVN02Mkc/
>>%1 echo W+tEeQQUgJauD8dcMo+hKWNCVhlKU31A6Qpej2t98EdeBNwXMkMzX8rZAtmjdbzBrYBPKi223IjS
>>%1 echo Rw8cP5UlLP9Mwh2v1VVF6cYCJQcVFdJyIEIu88xghVAtJKcGV4YyAXTnUUoYrxbIVBs6j8giXi+W
>>%1 echo 0SJMkgCR6fU2CdByNQ0Wd5Hu4jzF93A6+GV6D3+dToMuw76egkGad23zhoVk/ABWyRGEcyd+tdzR
>>%1 echo rihn6YT0LPGmVsVrjkDbSki8Uc6pJkNxPFKi904MCuX9xn5worc1qrkD32CradHJGcZr3uTI8YPD
>>%1 echo DhrFltAxGWq15mAfy0eSdRnGSbI4PWEa98ZVhgGmUxruBWOAeoLdCU+C/OSjPjjyJH2JnHDtYINL
>>%1 echo N537F536F7z1nStIn4KzTqa6yNO38LgUT96nncj43JQhWd3WAockgmJ4Ql2jh1ulXtGZ3BgzinzJ
>>%1 echo vVxFy43uqQ+qdKktiT9v6AEPUyEmxfZKo+WtRh33K6rJhxo8BTeET5Quro/hes9Xi38PsJETr9JZ
>>%1 echo d1QvxIuH9h+rH32gfpzeG0Y3Q8erAT7nbs85DCVai0piAbPEjofejdNvfB2l/+/rx6Qr6l9QSwME
>>%1 echo FAAAAAgAFFMuXUanXrbEAAAArQEAACAAHABlc3RpbG9zL2ZvdG8tcmVhbC9wbGFudGlsbGEuaHRt
>>%1 echo bFVUCQADZ8unamfLp2p1eAsAAQQAAAAABAAAAABtkMEOgyAMhu97is7EeDTekXch0gUyRhmiF8O7
>>%1 echo D5gadTtB2v/7+7dM6hkGI8axr0ajJcKygCcDMVb8BsAO/RkNVZy1qXRtDWQDWi2pQABLDfpRfO49
>>%1 echo NIro2YCwEjDo94RBQB3Z6ITd+K1e8TR+F8XI2qziyQ6tTI51LPZMdRsZdJhyrMR9v4VS3THHMKF3
>>%1 echo lGe6PXApFWztZsxdJv3d1WlctzytoNJ+BovjS/jhkP5Xm88lJPmitkkJbb57oCDMiVsDrM8HUEsD
>>%1 echo BBQAAAAIABRTLl08qKSZywAAADcBAAALABwAY29uZmlnLmpzb25VVAkAA2fLp2pny6dqdXgLAAEE
>>%1 echo AAAAAAQAAAAAVY5BbgIxDEX3c4oobJlWCLooq0pUvcbIJJmpVceOnEylCnGYnoWLkQywYGV9vedv
>>%1 echo nzpjbAR1YPfmVEONLPGooWb7Oevln80BFHIWu77xb2BPC//wswK7Z0wySYNL62tLL4mnB3VCokNS
>>%1 echo ZIcJqImrzXb7tXu3VTg3yzqC35DbQ8aOQAMkHH7CX3Pt2tgkRMhQUDg/sfu6DyPMVO4FUXwgGTDC
>>%1 echo FLhpDCz9EeqAPqm0xpAL0vJ08FhEEajPQXFscBSNUBa627/VI925uwJQSwECHgMKAAAAAAAUUy5d
>>%1 echo AAAAAAAAAAAAAAAACAAYAAAAAAAAABAA7UEAAAAAdHJhYmFqby9VVAUAA2fLp2p1eAsAAQQAAAAA
>>%1 echo BAAAAABQSwECHgMUAAAACAAUUy5dyeZDbx4CAACbBQAAHwAYAAAAAAABAAAApIFCAAAAdHJhYmFq
>>%1 echo by9jYXJydXNlbC1mb3RvLXJlYWwuanNvblVUBQADZ8unanV4CwABBAAAAAAEAAAAAFBLAQIeAxQA
>>%1 echo AAAIABRTLl0oRwTPiAMAAM8IAAAYABgAAAAAAAEAAACkgbkCAAB0cmFiYWpvL2NhcnJ1c2VsLWlh
>>%1 echo Lmpzb25VVAUAA2fLp2p1eAsAAQQAAAAABAAAAABQSwECHgMKAAAAAAAUUy5dAAAAAAAAAAAAAAAA
>>%1 echo CAAYAAAAAAAAABAA7UGTBgAAc2NyaXB0cy9VVAUAA2fLp2p1eAsAAQQAAAAABAAAAABQSwECHgMU
>>%1 echo AAAACAAUUy5drBfRYmUFAABBDgAAEgAYAAAAAAABAAAApIHVBgAAc2NyaXB0cy9nZW5lcmFyLnB5
>>%1 echo VVQFAANny6dqdXgLAAEEAAAAAAQAAAAAUEsBAh4DCgAAAAAAFFMuXQAAAAAAAAAAAAAAAAgAGAAA
>>%1 echo AAAAAAAQAO1BhgwAAGVzdGlsb3MvVVQFAANny6dqdXgLAAEEAAAAAAQAAAAAUEsBAh4DCgAAAAAA
>>%1 echo FFMuXQAAAAAAAAAAAAAAABIAGAAAAAAAAAAQAO1ByAwAAGVzdGlsb3MvZm90by1yZWFsL1VUBQAD
>>%1 echo Z8unanV4CwABBAAAAAAEAAAAAFBLAQIeAxQAAAAIABRTLl1dbgCzowAAAN0AAAAdABgAAAAAAAEA
>>%1 echo AACkgRQNAABlc3RpbG9zL2ZvdG8tcmVhbC9wcmVzZXQuanNvblVUBQADZ8unanV4CwABBAAAAAAE
>>%1 echo AAAAAFBLAQIeAxQAAAAIABRTLl06WCqnvQIAAHMGAAAcABgAAAAAAAEAAACkgQ4OAABlc3RpbG9z
>>%1 echo L2ZvdG8tcmVhbC9lc3RpbG8uY3NzVVQFAANny6dqdXgLAAEEAAAAAAQAAAAAUEsBAh4DFAAAAAgA
>>%1 echo FFMuXUanXrbEAAAArQEAACAAGAAAAAAAAQAAAKSBIREAAGVzdGlsb3MvZm90by1yZWFsL3BsYW50
>>%1 echo aWxsYS5odG1sVVQFAANny6dqdXgLAAEEAAAAAAQAAAAAUEsBAh4DFAAAAAgAFFMuXTyopJnLAAAA
>>%1 echo NwEAAAsAGAAAAAAAAQAAAKSBPxIAAGNvbmZpZy5qc29uVVQFAANny6dqdXgLAAEEAAAAAAQAAAAA
>>%1 echo UEsFBgAAAAALAAsA2QMAAE8TAAAAAA==
goto :eof

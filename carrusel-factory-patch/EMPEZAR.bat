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

set "PY="
REM 1) El lanzador oficial "py" es el mas fiable y no lo secuestra la Store.
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
REM 2) Rutas habituales de instalacion, por si no hay lanzador.
if not defined PY for %%V in (313 312 311 310) do (
  if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe"
  if not defined PY if exist "C:\Python%%V\python.exe" set "PY=C:\Python%%V\python.exe"
  if not defined PY if exist "%ProgramFiles%\Python%%V\python.exe" set "PY=%ProgramFiles%\Python%%V\python.exe"
)
REM 3) Ultimo recurso: "python" del PATH, siempre que no sea el atajo de la Store.
if not defined PY (
  python -c "import sys" >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo  ERROR: no encuentro Python.
  echo.
  echo  Si acabas de instalarlo, cierra esta ventana y vuelve a abrirla.
  echo.
  echo  Si no lo tienes: https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe
  echo  Al instalar, marca la casilla "Add python.exe to PATH".
  echo.
  echo  Si ya lo instalaste y sigue fallando, es el atajo de Microsoft Store:
  echo  Configuracion ^> Aplicaciones ^> Configuracion avanzada de aplicaciones
  echo  ^> Alias de ejecucion de aplicaciones ^> desactiva los dos "python.exe".
  pause & exit /b 1
)
echo  Python detectado: %PY%

set "BASE=%~dp0"
set "DEST=%BASE%carrusel-factory"
set "TMPD=%BASE%_parche_tmp"

echo  [1/6] Extrayendo el parche...
if exist "%TMPD%" rd /s /q "%TMPD%"
mkdir "%TMPD%"
call :ESCRIBIR_B64
if exist %1 del %1
>>%1 echo UEsDBBQAAAAIAMFRLl08qKSZywAAADcBAAALAAAAY29uZmlnLmpzb25VjkFuAjEMRfdziihsmVYI
>>%1 echo uiirSlS9xsgkmalVx46cTKUKcZiehYuRDLBgZX2952+fOmNsBHVg9+ZUQ40s8aihZvs56+WfzQEU
>>%1 echo cha7vvFvYE8L//CzArtnTDJJg0vra0sviacHdUKiQ1JkhwmoiavNdvu1e7dVODfLOoLfkNtDxo5A
>>%1 echo AyQcfsJfc+3a2CREyFBQOD+x+7oPI8xU7gVRfCAZMMIUuGkMLP0R6oA+qbTGkAvS8nTwWEQRqM9B
>>%1 echo cWxwFI1QFrrbv9Uj3bm7AlBLAwQUAAAACADBUS5drBfRYmUFAABBDgAAEgAAAHNjcmlwdHMvZ2Vu
>>%1 echo ZXJhci5weY1Xy27jNhTd6ysu1AKWEFnJDFqgMOoCg3RQdDMzSB+b1BBoi7KZUKRKUmhSw3/RZTfz
>>%1 echo AV0X6LL5k35JLx+yJFtJOwFG8n3z3MtDKo7j9+rnlmpDSqkWwCkFo8ia3MnLDVGq1ZTnd1qKDLZU
>>%1 echo UEWASw2VFCU+vn0DiWZAOaA/49LpWk3S6BEUFSVV7Ffv8OHdN1AxQTjVQAXI1jStufxS83Y7Lymf
>>%1 echo G1qTry7zKPpBywWoVuRrYkJGBQAJSptHs5MC9EaxxujLoMybxzSK4zhidSOVAVtr9y5196YfddS9
>>%1 echo 1xIzSl2wmmCMTurrjSol67AaDUGFOGyJKrzUW7T4eqrfSFGxbQY1URsSfrWKlCTDBRn83642A0Mf
>>%1 echo jCx2puZRFJW0QnsmknQR4TKh4UQUDSydRxKHTsQZxKNmxKmzZhUIaZeZN8TscqYrxmniY4SALqhi
>>%1 echo wiTx25ub9zcL9AD6wLR5ps95iD1w/PD0ByJGgcA1J21JbQex55sdtghHB81oQxR1shAKEmr7tCZW
>>%1 echo aAtKbbCaKjmMj13JsRaTvEojJ/yFmR3IhoqwiAxTbWTJxHYZt6aafxGnQHD8BmtDO4TLVc4lKZMq
>>%1 echo hNpUW5SPWpOMUDtrU4Iu56i9efpLWMx2mLc3lmBaH2ECr6/ZNFgLmB0jQM28/wwS4yDctsIQ9fTR
>>%1 echo 7ZeSGKnTF7HC0SEtN9qustrmW4qZOxkOzP7gfYWs14qG4UVbC5g39iJEVKpjsJEGp64k6n6+lrwM
>>%1 echo lRj12CN0jDnaIMkoo3ejDxvaGPiR8Ja+VQoTIpr0FOuqG9E9Pby08kqqGvEZLSbIplbTqXA5ny0+
>>%1 echo D4E9CYxCeFGghalAYwMMJ4iQ8zXBB5k3SobQSIAFIxh6LSVPPAy3MXZYUxOvfChr40gULeO096uk
>>%1 echo W9d/eiKDYMKmd8ZfdWOKNdEU/addBza2+jjA6cZwOEVOMBghv1PMg0EjP/PObEdEyakHaiD27Q8J
>>%1 echo eveN5Gg3CuBEhe39hjWEW5dPXrl/XWk4WA015MiH/tyIPZUmfevs8TEkSUQlDaPiDqrlkSPvJJJt
>>%1 echo CIsOvgk6VIpGNbmnJVO6t3FkWcj75feqpaEuzVlJ9Wh6vAiLuF2FrSIN4WjCkc288kg/QbWEq3OS
>>%1 echo HnAoso5heMqFdC+yAUMIbEG3Kw+ctASPCfKrbssAnlcihOrTWvIM4y0G8f1sWsRQ/04KetRg+cdB
>>%1 echo xQGA4yazm6+P67uHegx/67Ur69ufVWStk6MqRY7EyXVd7oWjaNOHnc1xknaCUNyqYS8O/vgTm5YK
>>%1 echo o/C+QsAtZLbXtzP7NlsdZkOcp/Aeykc42Vp6cuQBKaSCEU5+0xd+M55CNoo3mlk/qBlUPsR8LxZX
>>%1 echo r8tD3oht/H+A6iNPwmWLwZTJkEcuIMa/C9/AcdmrNNcG72HJOVQd9ADf9aj7yxrG8Cu0N0c8CmHv
>>%1 echo KfWQ51Ogjy9qebjw+S0bCs26wyAL1pmlsWyA43lYvzculqfxnbwoaeLlvSNW6i5tiM9+FC02zLR4
>>%1 echo UC4Gl7okNDqoHA2m2dgNx081025BNenmeXnR8/GJXqBOnMgc1dhM9nmiU9JqQmL7w2U9MaKG4R3P
>>%1 echo kMlqj8rTeg89UxGcAvIsA1eeOJ8ZZ8dqOWnwRlgmSdeHYXuzkCANPNhN3033+WGnbe9Wf+ho++8/
>>%1 echo u6vLbD+6rBxmVtddL/bhZTCd/iMh94/CyJLocExnvtbhPPbH3qi2+Cfxz++/wXXH8hyPl+Ot+GTz
>>%1 echo 6AV0xfdXfjen53cngGs32AR3xkOO3yZPH+2OsV9pC/h0773y19XhLNW1bwbeu0JbrAl+LlVQFILU
>>%1 echo tCjsWRUXhf1SKYp4EY51+9kS/QtQSwMEFAAAAAgA0VEuXcnmQ28eAgAAmwUAAB8AAAB0cmFiYWpv
>>%1 echo L2NhcnJ1c2VsLWZvdG8tcmVhbC5qc29ujZTBbtswDIbveQrCZy9126QFcinSYYcB3WUFepl3YGw2
>>%1 echo UydLniRnS4u+1C47DsiTjbSdOHU8wDlFIv3rI/VTLxOAKFCB0QKiB6U1Ahm4V2FNPoolSD4obSX8
>>%1 echo aIN95wh1E3i0rsBQR2aLebOXBRF6YUlV1pGftIpiOeFXk7lck8kRQgUb5VWoT8srhyZDh97bqRwL
>>%1 echo UU4Btaa9ArzW6l6rnOML+MIrkGMML84531ktud+s/c6fN7+IgvpRUU0UHXabUFChaoo6qfmQk1Xk
>>%1 echo miKSJIFi9xt2fyCBnMtWwTplvWxwGQE9oIYCnaBLl/bd8mfJ+fSpXLcFHJAvOmQuCB3/Z5r4LfIH
>>%1 echo DR61NQ3SEfJd9Qw5ga9caoLNLZCGXGEUHyG/X366/bj8vIC2kyD3xotWc9p1qcd7McR7OYb3DiGz
>>%1 echo mTJYax/xLleKXMDUbKHkW+aWbZTT43hB71X3yH3gyyHg2UjgQM7hc018BMydLyg4mxrO5Xv14Akq
>>%1 echo /x9icQaDtlKwBfYGmYCZavvcJ54NEc9HWqKzH9N0yPeVCpSa0imTqVJG9MTFB+AVGiuO9/JNDBuZ
>>%1 echo cJaNWy8zc594PkR8NZKYe2Gdsb0eL2EOhTIV66dGfNmMzzBxLmBcGN+E+IJ43qDUuMWzzGpa8ygO
>>%1 echo QF8NQV930PJWddN+DP1QP00aTyZv95c9s6FCmLlryL4o0ODNG2OMe+IGnHzdAjPv18nr5B9QSwME
>>%1 echo FAAAAAgAm1UuXTU6+GCzAwAAtgkAABgAAAB0cmFiYWpvL2NhcnJ1c2VsLWlhLmpzb26tVk2PG0UQ
>>%1 echo ve+vKPk8WQlIOOwFAcoBKZGQcgQUlWfK48Y9XUN/2Gui/TH8gD1E/AAk/Md41W2z7MYkWcjB9kx1
>>%1 echo Tc/r915V+c0F0SLLxIsrWnwXskSnURL9UoTwO7vIgXz5ddFZoqTsvFqqDC5rdOyfJDyyasuTDuL1
>>%1 echo tZt4lGBZs3rvAmenIT1Z+XLd8lYaJ851n6dXz1qszwbhDS4NkJvr6k6WdbVivG5PfI29B6ZcaOuS
>>%1 echo y0wSaCiA2XPklPRS0umZQTJ7L6edELyp70reDci6oh9qXnsp4ob5s+50F9Xbk2vVzeLvYHa5NAbu
>>%1 echo yPoxnGWr5vdFYjvLC62kJpmBk0pg6jkxLTXYIQa5C1maBJ408uXdTisNA7jl13PUac625eQCuPYu
>>%1 echo ZZpMEIl4vxgEt3VhpKg6EWca1Q9gaa0lduQ5jkI7h912CbcuYMnYLThBRzuOE0EyMOqxOK5zB3Ay
>>%1 echo IwUB7nsJGWkc+zVe2Le8ea1Zx8jzet/RVLIMHQWtu9aLWXSGDvUoN927pH/+kHTIwxHXoPoM9S+Y
>>%1 echo 4D0A4d4dfg/n2H5VIu1JYVghtiODFfE0HG75kp4n8gAV3SSxqTJBuUntXFC1ud9rAqs5anq/CKkE
>>%1 echo 7zJV8nshXRGTFUIMD0TZOu/Z+DdIK8SDajhRnLIGhMNAO1Wwl3SVKa25iVQpbQqkzf697D+G9i8e
>>%1 echo R/tzT1vuD7d6jvCXEoywIktvNpoOvyViF+WSoFaSkJpWZnSeZjBWBoRpcEkOb7nCxW0PVj/S9SS4
>>%1 echo 36ParkvckztWY0drEEq9OBh7BJCZvdDsGUaIMLf3iCUsIQqn92tghMGhPrpU32gfeH9UpfFuW+Qs
>>%1 echo n4z2p4+j/SXb0YAhoYIDHK3pnADfO8ExgJnhPa6FrbB62MrPgqKlJQoGJWH40GSqELBpbZ+9C70S
>>%1 echo H95+yOs9igKNajaXn3pEc64x25Hypvq3Grl1lr7EzC5AINTFUaz7dbHWSY59J6Ev0z3ubfN32o31
>>%1 echo dfc/BHj26HaTgTW5f+02p1kAfoGhXcJksHPMYiLQK5dHCKgof/pW4sBhD40kKT4WmzAEBhzMSsxr
>>%1 echo /EDLEZ5gh0TWxPEqLbn+NpQ2bY9t6Fz/seFnw2FETSSy5wBrthkAC9DIEaMCFVHS5l7jt85kEp0K
>>%1 echo 7STTJ6qJLx9KYv8Hzmjx5x/flIQpWaclp8PtV+f0+Pj/COcJHjhuUB06PPRq5fBOY8zWpcesaJO1
>>%1 echo 8nMcrKBXcTn+k8PaulFr0nrNf2EO3z9d3Fz8BVBLAwQUAAAACADBUS5dXW4As6MAAADdAAAAHQAA
>>%1 echo AGVzdGlsb3MvZm90by1yZWFsL3ByZXNldC5qc29uTY6xCsIwEIb3PsVxcykUVDCbQ52cuoqEM0kl
>>%1 echo 0uRCkoIivrtJuzjd8X/c/92nAUBtkoo2KMseBeCZM8M4nC6gDcwEIXKwRpMGxY5hYq+5Lbsv/BGp
>>%1 echo AIY3ZPMqZ8Yr66iDQdvM0dK8dixP7rCtqiWRXAukpeKaaE7mD2SWq62yHJcNlcSFLO+UTH1vK5o4
>>%1 echo OsqcSnLFndhjC9iLvo6j6A94a77ND1BLAwQUAAAACADBUS5dOlgqp70CAABzBgAAHAAAAGVzdGls
>>%1 echo b3MvZm90by1yZWFsL2VzdGlsby5jc3OdVNuOmzAQfc9XWKrSBDVmDQlZFrTqSn2o1L9wsCHugu3a
>>%1 echo Jpet+u8dA8mSS/ehDyBsD8dn5pyZF9FoZRxqTT2fbZ3TNnt4KJV0NqyUqmpOtbBhoZqHwtr4a0kb
>>%1 echo UR+fvynTKEOl+/KdGtooybJ9tXUvS0LyhJDPQ9gPZd37wWo4ZMLqmh6f7Z7qWZBPJqGtBePo9wQh
>>%1 echo raxwQskMGV5TJ3Y8R3vB3DZDESHTHG25ALxhBT9saPFaGdVKhkVDK56hHTVzjCEFpoKrCCveIKBQ
>>%1 echo O27y8f77rQWXDg4vfytUrcwJuKGmoB3wkEeGypof8u6NmTC8GKBU3TYyRz9b60R5BBSAlq4Px1wy
>>%1 echo j6EpY0JWGUpTfUDpCl6Pa33wR14E3BcyQzNfytkC2aN1vMGtgE8qLbbciNJHDxw/lSUs/0zCHa/V
>>%1 echo VUXpxgIlBxUV0nIgQi7zzGCFUC0kpwZXhjIBdOdRShivFshUGzqPyCJeL5bRIkySAJHp9TYJ0HI1
>>%1 echo DRZ3ke7iPMX3cDr4ZXoPf51Ogy7Dvp6CQZp3bfOGhWT8AFbJEYRzJ3613NGuKGfphPQs8aZWxWuO
>>%1 echo QNtKSLxRzqkmQ3E8UqL3TgwK5f3GfnCitzWquQPfYKtp0ckZxmve5Mjxg8MOGsWW0DEZarXmYB/L
>>%1 echo R5J1GcZJsjg9YRr3xlWGAaZTGu4FY4B6gt0JT4L85KM+OPIkfYmccO1gg0s3nfsXnfoXvPWdK0if
>>%1 echo grNOprrI07fwuBRP3qedyPjclCFZ3dYChySCYnhCXaOHW6Ve0ZncGDOKfMm9XEXLje6pD6p0qS2J
>>%1 echo P2/oAQ9TISbF9kqj5a1GHfcrqsmHGjwFN4RPlC6uj+F6z1eLfw+wkROv0ll3VC/Ei4f2H6sffaB+
>>%1 echo nN4bRjdDx6sBPuduzzkMJVqLSmIBs8SOh96N0298HaX/7+vHpCvqX1BLAwQUAAAACADBUS5dRqde
>>%1 echo tsQAAACtAQAAIAAAAGVzdGlsb3MvZm90by1yZWFsL3BsYW50aWxsYS5odG1sbZDBDoMgDIbve4rO
>>%1 echo xHg03pF3IdIFMkYZohfDuw+YGnU7Qdr/+/u3TOoZBiPGsa9GoyXCsoAnAzFW/AbADv0ZDVWctal0
>>%1 echo bQ1kA1otqUAASw36UXzuPTSK6NmAsBIw6PeEQUAd2eiE3fitXvE0fhfFyNqs4skOrUyOdSz2THUb
>>%1 echo GXSYcqzEfb+FUt0xxzChd5Rnuj1wKRVs7WbMXSb93dVpXLc8raDSfgaL40v44ZD+V5vPJST5orZJ
>>%1 echo CW2+e6AgzIlbA6zPB1BLAQIUAxQAAAAIAMFRLl08qKSZywAAADcBAAALAAAAAAAAAAAAAACkgQAA
>>%1 echo AABjb25maWcuanNvblBLAQIUAxQAAAAIAMFRLl2sF9FiZQUAAEEOAAASAAAAAAAAAAAAAACkgfQA
>>%1 echo AABzY3JpcHRzL2dlbmVyYXIucHlQSwECFAMUAAAACADRUS5dyeZDbx4CAACbBQAAHwAAAAAAAAAA
>>%1 echo AAAApIGJBgAAdHJhYmFqby9jYXJydXNlbC1mb3RvLXJlYWwuanNvblBLAQIUAxQAAAAIAJtVLl01
>>%1 echo OvhgswMAALYJAAAYAAAAAAAAAAAAAACkgeQIAAB0cmFiYWpvL2NhcnJ1c2VsLWlhLmpzb25QSwEC
>>%1 echo FAMUAAAACADBUS5dXW4As6MAAADdAAAAHQAAAAAAAAAAAAAApIHNDAAAZXN0aWxvcy9mb3RvLXJl
>>%1 echo YWwvcHJlc2V0Lmpzb25QSwECFAMUAAAACADBUS5dOlgqp70CAABzBgAAHAAAAAAAAAAAAAAApIGr
>>%1 echo DQAAZXN0aWxvcy9mb3RvLXJlYWwvZXN0aWxvLmNzc1BLAQIUAxQAAAAIAMFRLl1Gp162xAAAAK0B
>>%1 echo AAAgAAAAAAAAAAAAAACkgaIQAABlc3RpbG9zL2ZvdG8tcmVhbC9wbGFudGlsbGEuaHRtbFBLBQYA
>>%1 echo AAAABwAHAO8BAACkEQAAAAA=
goto :eof

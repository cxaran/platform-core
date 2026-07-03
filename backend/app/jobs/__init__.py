"""Tareas en segundo plano (Taskiq sobre PostgreSQL).

El broker y el scheduler viven en ``backend/app/taskiq_app.py`` (entrypoint de los
procesos worker/scheduler del compose, profile "taskiq"); las tareas concretas viven
en ``backend/app/jobs/tasks/``.
"""

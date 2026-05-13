from ultralytics import YOLO

def train():
    import os
    import csv
    model = YOLO("yolov8n.pt")  # start small (nano)

    results = model.train(
        data="../data/data.yaml",
        epochs=50,
        imgsz=640,
        batch=16,
        name="dumping_detector",
        device="cpu"  # change to 'cuda' if GPU
    )

    # Export metrics to CSV
    metrics = results.metrics if hasattr(results, 'metrics') else None
    if metrics:
        output_dir = os.path.join("runs", "detect", "dumping_detector")
        os.makedirs(output_dir, exist_ok=True)
        csv_path = os.path.join(output_dir, "results.csv")
        with open(csv_path, mode="w", newline="") as csvfile:
            writer = csv.writer(csvfile)
            writer.writerow(["metric", "value"])
            for k, v in metrics.items():
                writer.writerow([k, v])
        print(f"Training metrics exported to {csv_path}")
    else:
        print("No metrics found to export.")

if __name__ == "__main__":
    train()
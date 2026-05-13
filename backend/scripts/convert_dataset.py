import os
import shutil
from PIL import Image

def convert_dataset(base_dir):
    for split in ['train', 'valid', 'test']:
        split_dir = os.path.join(base_dir, split)
        if not os.path.exists(split_dir):
            continue
        
        images_dir = os.path.join(split_dir, 'images')
        labels_dir = os.path.join(split_dir, 'labels')
        os.makedirs(images_dir, exist_ok=True)
        os.makedirs(labels_dir, exist_ok=True)
        
        annotations_path = os.path.join(split_dir, '_annotations.txt')
        if not os.path.exists(annotations_path):
            print(f"No annotations found for {split} at {annotations_path}")
            continue
            
        print(f"Processing {split} annotations...")
        with open(annotations_path, 'r') as f:
            lines = f.readlines()
            
        count = 0
        for line in lines:
            parts = line.strip().split()
            if len(parts) < 2:
                continue
            
            image_name = parts[0]
            bboxes = parts[1:]
            
            image_path_src = os.path.join(split_dir, image_name)
            image_path_dst = os.path.join(images_dir, image_name)
            
            if not os.path.exists(image_path_dst):
                if os.path.exists(image_path_src):
                    # Move image to images/
                    shutil.move(image_path_src, image_path_dst)
                else:
                    continue
            
            count += 1
            # Create label file
            label_name = os.path.splitext(image_name)[0] + '.txt'
            label_path = os.path.join(labels_dir, label_name)
            
            with Image.open(image_path_dst) as img:
                w, h = img.size
                
            with open(label_path, 'a') as lf:
                for bbox in bboxes:
                    # Format: x_min,y_min,x_max,y_max,class_id
                    coords = bbox.split(',')
                    if len(coords) < 5:
                        continue
                    
                    x_min = float(coords[0])
                    y_min = float(coords[1])
                    x_max = float(coords[2])
                    y_max = float(coords[3])
                    class_id = coords[4]
                    
                    # Normalize for YOLO (x_center, y_center, width, height)
                    x_center = (x_min + x_max) / 2 / w
                    y_center = (y_min + y_max) / 2 / h
                    width = (x_max - x_min) / w
                    height = (y_max - y_min) / h
                    
                    lf.write(f"{class_id} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}\n")
        
        print(f"Processed {count} annotations for {split}")
        
        # Move remaining images if any
        moved_extra = 0
        for f in os.listdir(split_dir):
            if f.lower().endswith(('.jpg', '.jpeg', '.png')) and os.path.isfile(os.path.join(split_dir, f)):
                shutil.move(os.path.join(split_dir, f), os.path.join(images_dir, f))
                moved_extra += 1
        
        if moved_extra > 0:
            print(f"Moved {moved_extra} extra images for {split}")
                
        print(f"Finished {split} split")

if __name__ == "__main__":
    convert_dataset('data')

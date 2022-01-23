import subprocess
import json
import math
import time
import sys


FILE_SIZE_LIMIT_IN_BYTES = 8388608 # 8 * 1024 * 1024

def get_file_path():

    return sys.argv[1]


def get_data(file_path):
    stdout = subprocess.run(f'.\\ffprobe.exe -i "{file_path}" -v quiet -print_format json -show_streams -show_format', capture_output=True, encoding='UTF-8').stdout
    data_json = json.loads(stdout)
    
    return data_json


def check_file_size(file_path):
    data = get_data(file_path)
    if int(data['format']['size']) < FILE_SIZE_LIMIT_IN_BYTES:
        return '<8mb'

    return '>8mb'


def split_video(file_path, output_path, output_file_video, output_file_audio):
    subprocess.run(f'.\\ffmpeg.exe -i "{file_path}" -y -c:v copy -an "{output_path + output_file_video}" -c:a copy -vn "{output_path + output_file_audio}"')


def check_video_resolution(file_path):
    video_data = get_data(file_path)
    if {int(video_data['streams'][0]['width']), int(video_data['streams'][0]['height'])}.issubset({1920, 1080}):
        return True
    
    return False
        

def rescale_video(file_path, output_path, output_file_name, target_resolution):
    is_video_1080 = check_video_resolution(file_path)
    if is_video_1080:
        subprocess.run(f'.\\ffmpeg.exe -i "{file_path}" -y -s {target_resolution} "{output_path + output_file_name}"')
        return True
    
    return False


def merge_video(file_path_1, file_path_2, output_path, output_file_name):
    subprocess.run(f'.\\ffmpeg.exe -i "{file_path_1}" -i "{file_path_2}" -y -c copy "{output_path + output_file_name}"')


def determine_target_bitrate(video_file_path, audio_file_path):
    video_data = get_data(video_file_path)
    audio_data = get_data(audio_file_path)
    reduction_coefficient = int(video_data['format']['size']) / (FILE_SIZE_LIMIT_IN_BYTES - int(audio_data['format']['size']))
    target_bitrate = int(video_data['streams'][0]['bit_rate']) / math.ceil(reduction_coefficient)

    return target_bitrate


def change_bitrate(file_path, output_path, output_file_name, target_bitrate):
    subprocess.run(f'.\\ffmpeg.exe -i "{file_path}" -y -b:v {target_bitrate} -maxrate:v {target_bitrate} -bufsize 4M "{output_path + output_file_name}"')


def return_compressed_video(file_path, output_path, output_file_name):
    subprocess.run(f'.\\ffmpeg.exe -i "{file_path}" -y -c copy "{output_path + output_file_name}"')


def main():
    original_file_path = get_file_path()

    try:
        if check_file_size(original_file_path) == '<8mb':
            print('\nFILE IS ALREADY UNDER 8MB!')
            time.sleep(2)
            sys.exit(0)

    except KeyError as e:
        print('\nINVALID FILE FORMAT.')
        time.sleep(2)
        sys.exit(1)

    split_video(original_file_path, '.\\tmp\\', 'video_only.mp4', 'audio_only.mp4')

    was_rescaled = rescale_video('.\\tmp\\video_only.mp4', '.\\tmp\\', 'rescaled_video.mp4', '1680x1050')

    if was_rescaled is False:
        merge_video('.\\tmp\\video_only.mp4', '.\\tmp\\audio_only.mp4', '.\\tmp\\', 'merged.mp4')
    else:
        merge_video('.\\tmp\\rescaled_video.mp4', '.\\tmp\\audio_only.mp4', '.\\tmp\\', 'merged.mp4')

    if check_file_size('.\\tmp\\merged.mp4') == '>8mb' and was_rescaled:
        target_bitrate = determine_target_bitrate('.\\tmp\\rescaled_video.mp4', '.\\tmp\\audio_only.mp4')
        change_bitrate('.\\tmp\\merged.mp4', original_file_path, '_8mb.mp4', target_bitrate)
    elif check_file_size('.\\tmp\\merged.mp4') == '>8mb':
        target_bitrate = determine_target_bitrate('.\\tmp\\video_only.mp4', '.\\tmp\\audio_only.mp4')
        change_bitrate('.\\tmp\\merged.mp4', original_file_path, '_8mb.mp4', target_bitrate)
    else:
        return_compressed_video('.\\tmp\\merged.mp4', original_file_path, '_8mb.mp4')


main()